from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from collections import Counter

import fitz
import ocrmypdf
from ocrmypdf import exceptions as ocrmypdf_exceptions

from pdf_editor_document_engine.models.text import (
    DetectedTextBlockModel,
    PreviewTextLayoutRequest,
    PreviewTextLayoutResponse,
    ResolveFontResourceRequest,
    ResolveFontResourceResponse,
    ReplaceTextRequest,
    ReplaceTextResponse,
    RunOcrRequest,
    RunOcrResponse,
    TextGlyphModel,
    TextPreviewBackgroundModel,
    TextPreviewLineModel,
    TextPreviewSpanModel,
    TextOverlayCommitRequest,
    TextOverlayCommitResponse,
    UpdateTextLayoutRequest,
    UpdateTextLayoutResponse,
)
from pdf_editor_document_engine.services.font_registry import FontRegistry, ResolvedFontResource


logger = logging.getLogger("pdf_editor_document_engine.text")


def normalize_editable_text_characters(value: str) -> str:
    normalized_value = str(value or "")
    if not normalized_value:
        return normalized_value

    normalized_value = (
        normalized_value
        .replace("\ufb00", "ff")
        .replace("\ufb01", "fi")
        .replace("\ufb02", "fl")
        .replace("\ufb03", "ffi")
        .replace("\ufb04", "ffl")
    )

    false_f_characters = "\u03d0\u03b2\ufffd\u0000"

    def replace_false_beta(match: re.Match[str]) -> str:
        token = match.group(0)
        return re.sub(f"[{re.escape(false_f_characters)}]", "f", token)

    normalized_value = re.sub(
        rf"[A-Za-z0-9][A-Za-z0-9{re.escape(false_f_characters)}]*"
        rf"[{re.escape(false_f_characters)}][A-Za-z0-9{re.escape(false_f_characters)}]*",
        replace_false_beta,
        normalized_value,
    )
    return normalized_value


def apply_recovered_text_to_glyph_run(
    glyph_run: list[TextGlyphModel],
    recovered_text: str,
) -> list[TextGlyphModel]:
    if not glyph_run or len(glyph_run) != len(recovered_text):
        return glyph_run

    for index, character in enumerate(recovered_text):
        glyph_run[index].unicodeText = character
        glyph_run[index].codePoint = ord(character) if character else 0
    return glyph_run


def normalize_text(value: str) -> str:
    return " ".join(normalize_editable_text_characters(value).split()).strip()


def ensure_existing_file(path_value: str) -> str:
    normalized_path = str(Path(path_value).expanduser())
    if not os.path.isfile(normalized_path):
        raise FileNotFoundError(f"The PDF file was not found: {normalized_path}")
    return normalized_path


def build_text_block_id(
    page_number: int,
    bbox: list[float],
    text: str,
    font_size: float,
    font_name: str,
    seqno: int | None = None,
    font_resource_name: str | None = None,
) -> str:
    bbox_key = ":".join(f"{float(value):.3f}" for value in bbox)
    raw_value = (
        f"{page_number}|{bbox_key}|{normalize_text(text)}|{float(font_size):.3f}|"
        f"{font_name or ''}|{int(seqno or 0)}|{font_resource_name or ''}"
    )
    return hashlib.sha1(raw_value.encode("utf-8")).hexdigest()


def color_to_rgb_tuple(color_value) -> tuple[float, float, float]:
    if color_value is None:
        return (0.0, 0.0, 0.0)

    if isinstance(color_value, (list, tuple)) and len(color_value) >= 3:
        return tuple(float(max(min(component, 1.0), 0.0)) for component in color_value[:3])

    try:
        color_int = int(color_value)
    except (TypeError, ValueError):
        return (0.0, 0.0, 0.0)

    red = ((color_int >> 16) & 255) / 255.0
    green = ((color_int >> 8) & 255) / 255.0
    blue = (color_int & 255) / 255.0
    return (red, green, blue)


def rgb_tuple_to_hex(color_value: tuple[float, float, float] | None) -> str:
    if color_value is None:
        return "#000000"

    red = int(max(min(color_value[0], 1.0), 0.0) * 255)
    green = int(max(min(color_value[1], 1.0), 0.0) * 255)
    blue = int(max(min(color_value[2], 1.0), 0.0) * 255)
    return f"#{red:02x}{green:02x}{blue:02x}"


def resolve_dominant_span_style(spans: list[dict]) -> tuple[str, float, tuple[float, float, float]]:
    weighted_styles: Counter[tuple[str, float, tuple[float, float, float]]] = Counter()
    fallback_style: tuple[str, float, tuple[float, float, float]] = ("", 12.0, (0.0, 0.0, 0.0))

    for span in spans:
        raw_text = normalize_text(str(span.get("text", "")))
        span_font_name = str(span.get("font") or "").strip()
        span_font_size = float(span.get("size") or 0.0) or 12.0
        span_color = color_to_rgb_tuple(span.get("color"))
        span_bbox = [float(value) for value in (span.get("bbox") or [0, 0, 0, 0])]
        span_width = max(span_bbox[2] - span_bbox[0], 0.0)
        span_height = max(span_bbox[3] - span_bbox[1], 0.0)
        span_score = max(len(raw_text), 1) * max(span_width, 1.0) * max(span_height, 1.0)
        style_key = (span_font_name, round(span_font_size, 2), span_color)

        if raw_text and span_score > 0:
            weighted_styles[style_key] += span_score

        if raw_text and fallback_style[0] == "":
            fallback_style = (span_font_name, span_font_size, span_color)

    if weighted_styles:
        dominant_style = weighted_styles.most_common(1)[0][0]
        return dominant_style[0], float(dominant_style[1]), dominant_style[2]

    return fallback_style


def build_raw_span_style_key(span: dict) -> tuple[str, float, tuple[float, float, float]]:
    return (
        str(span.get("font") or "").strip(),
        round(float(span.get("size") or 0.0) or 12.0, 2),
        color_to_rgb_tuple(span.get("color")),
    )


def color_hex_to_rgb_tuple(color_hex: str | None, fallback: tuple[float, float, float]) -> tuple[float, float, float]:
    normalized = str(color_hex or "").strip()
    if len(normalized) == 7 and normalized.startswith("#"):
        try:
            red = int(normalized[1:3], 16) / 255.0
            green = int(normalized[3:5], 16) / 255.0
            blue = int(normalized[5:7], 16) / 255.0
            return (red, green, blue)
        except ValueError:
            return fallback

    return fallback


def derive_font_traits(font_name: str) -> tuple[bool, bool]:
    normalized_font_name = (font_name or "").lower()
    is_bold = any(token in normalized_font_name for token in ("bold", "black", "semibold", "demi"))
    is_italic = any(token in normalized_font_name for token in ("italic", "oblique"))
    return is_bold, is_italic


def build_layout_lines_from_spans(spans: list["InternalTextSpan"]) -> list[str]:
    if not spans:
        return []

    grouped_lines: dict[float, list[InternalTextSpan]] = {}
    for span in spans:
        if not span.text.strip():
            continue
        line_key = round(float(span.origin_y), 1)
        grouped_lines.setdefault(line_key, []).append(span)

    layout_lines: list[str] = []
    for baseline_y in sorted(grouped_lines):
        ordered_spans = sorted(grouped_lines[baseline_y], key=lambda span: (span.origin_x, span.origin_y))
        line_text = compose_visual_line_text_from_segments(
            build_visual_line_segments_from_internal_spans(ordered_spans)
        )
        if line_text:
            layout_lines.append(line_text)

    return layout_lines


def derive_line_height_ratio(spans: list["InternalTextSpan"], fallback_font_size: float) -> float:
    if not spans:
        return 1.18

    grouped_baselines = sorted({
        round(float(span.origin_y), 1)
        for span in spans
        if span.text.strip()
    })

    if len(grouped_baselines) < 2:
        return 1.18

    gaps = [
        max(grouped_baselines[index + 1] - grouped_baselines[index], fallback_font_size * 1.18)
        for index in range(len(grouped_baselines) - 1)
    ]
    average_gap = sum(gaps) / len(gaps)
    return max(average_gap / max(fallback_font_size, 0.1), 1.05)


def should_insert_visual_space(gap: float, current_font_size: float) -> bool:
    return gap > max(current_font_size * 0.22, 2.5)


def build_visual_line_segments_from_internal_spans(
    spans: list["InternalTextSpan"],
    source_x0: float = 0.0,
) -> list[dict[str, object]]:
    if not spans:
        return []

    ordered_spans = sorted(spans, key=lambda span: (span.origin_x, span.origin_y))
    visual_segments: list[dict[str, object]] = []
    previous_right = 0.0
    previous_font_size = 0.0
    previous_font_name = ""
    previous_color_hex = "#000000"
    previous_is_bold = False
    previous_is_italic = False
    has_previous_segment = False

    for span in ordered_spans:
        normalized_segment = normalize_text(span.text)
        if not normalized_segment:
            continue

        span_bbox = [float(value) for value in span.bbox]
        current_font_size = max(float(span.font_size or previous_font_size or 12.0), 6.0)
        gap = span_bbox[0] - previous_right if has_previous_segment else 0.0
        if has_previous_segment and should_insert_visual_space(gap, current_font_size):
            gap_x = max(previous_right - source_x0, 0.0)
            visual_segments.append(
                {
                    "text": " ",
                    "x": gap_x,
                    "width": max((span_bbox[0] - source_x0) - gap_x, 0.0),
                    "font_size": max(previous_font_size or current_font_size, 6.0),
                    "font_name": previous_font_name or span.font_name,
                    "color_hex": previous_color_hex,
                    "is_bold": previous_is_bold,
                    "is_italic": previous_is_italic,
                    "is_synthetic_gap": True,
                }
            )

        span_is_bold, span_is_italic = derive_font_traits(span.font_name)
        visual_segments.append(
            {
                "text": normalized_segment,
                "x": max(float(span.origin_x) - source_x0, 0.0),
                "width": max(float(span_bbox[2] - span_bbox[0]), 0.0),
                "font_size": current_font_size,
                "font_name": span.font_name,
                "color_hex": rgb_tuple_to_hex(span.color),
                "is_bold": span_is_bold,
                "is_italic": span_is_italic,
                "is_synthetic_gap": False,
            }
        )
        previous_right = span_bbox[2]
        previous_font_size = current_font_size
        previous_font_name = span.font_name
        previous_color_hex = rgb_tuple_to_hex(span.color)
        previous_is_bold = span_is_bold
        previous_is_italic = span_is_italic
        has_previous_segment = True

    return visual_segments


def compose_visual_line_text_from_segments(segments: list[dict[str, object]]) -> str:
    if not segments:
        return ""

    return "".join(str(segment.get("text") or "") for segment in segments).strip()


def build_preview_lines_from_text_lines(
    text_lines: list["InternalTextLine"],
    source_bbox: list[float],
    default_font_name: str,
    default_color: tuple[float, float, float],
    default_font_size: float,
) -> list[TextPreviewLineModel]:
    if not text_lines:
        return []

    source_x0 = float(source_bbox[0])
    source_y0 = float(source_bbox[1])
    preview_lines: list[TextPreviewLineModel] = []

    for text_line in text_lines:
        first_span = next((span for span in text_line.spans if span.text.strip()), None)
        if first_span is None:
            continue

        visual_segments = build_visual_line_segments_from_internal_spans(text_line.spans, source_x0)
        line_text = compose_visual_line_text_from_segments(visual_segments)
        if not line_text:
            continue

        is_bold, is_italic = derive_font_traits(first_span.font_name or default_font_name)
        preview_spans: list[TextPreviewSpanModel] = []
        for segment in visual_segments:
            if bool(segment.get("is_synthetic_gap")):
                continue

            preview_spans.append(
                TextPreviewSpanModel(
                    text=str(segment.get("text") or ""),
                    x=max(float(segment.get("x") or 0.0), 0.0),
                    width=max(float(segment.get("width") or 0.0), 0.0),
                    fontSize=max(float(segment.get("font_size") or default_font_size), 6.0),
                    fontName=str(segment.get("font_name") or default_font_name),
                    colorHex=str(segment.get("color_hex") or rgb_tuple_to_hex(default_color)),
                    isBold=bool(segment.get("is_bold")),
                    isItalic=bool(segment.get("is_italic")),
                )
            )

        preview_lines.append(
            TextPreviewLineModel(
                text=line_text,
                x=max(first_span.origin_x - source_x0, 0.0),
                y=max((text_line.bbox[1] - source_y0), 0.0),
                baselineY=max(text_line.baseline_y - source_y0, 0.0),
                fontSize=max(first_span.font_size or default_font_size, 6.0),
                fontName=first_span.font_name or default_font_name,
                colorHex=rgb_tuple_to_hex(first_span.color or default_color),
                isBold=is_bold,
                isItalic=is_italic,
                spans=preview_spans,
            )
        )

    return preview_lines


def clamp_unit(value: float) -> float:
    return max(min(float(value), 1.0), 0.0)


def normalize_bbox(page_rect: fitz.Rect, bbox: list[float]) -> dict[str, float]:
    x0, y0, x1, y1 = [float(value) for value in bbox]
    page_width = max(page_rect.width, 1.0)
    page_height = max(page_rect.height, 1.0)
    return {
        "x": max(min(x0 / page_width, 1.0), 0.0),
        "y": max(min(y0 / page_height, 1.0), 0.0),
        "width": max(min((x1 - x0) / page_width, 1.0), 0.0),
        "height": max(min((y1 - y0) / page_height, 1.0), 0.0),
    }


@dataclass(slots=True)
class InternalTextSpan:
    bbox: list[float]
    color: tuple[float, float, float]
    font_name: str
    font_size: float
    origin_x: float
    origin_y: float
    text: str
    glyph_run: list[TextGlyphModel] | None = None
    font_resource_name: str = ""
    font_postscript_name: str = ""
    font_family: str = ""
    font_source: str = ""
    font_resolution_status: str = "exact-source"
    to_unicode_available: bool = False
    can_embed_for_editing: bool = True
    missing_glyphs: list[str] | None = None


@dataclass(slots=True)
class InternalTextLine:
    baseline_y: float
    bbox: list[float]
    spans: list[InternalTextSpan]


@dataclass(slots=True)
class InternalTextBlock:
    bbox: list[float]
    color: tuple[float, float, float]
    font_name: str
    font_size: float
    page: fitz.Page
    page_number: int
    text: str
    text_block_id: str
    x: float
    y: float
    width: float
    height: float
    spans: list[InternalTextSpan]
    layout_container_id: str = ""
    editable_run_id: str = ""
    document_edit_mode: str = "digital-text"
    page_edit_mode: str = "digital-text"
    font_resource_name: str = ""
    font_postscript_name: str = ""
    font_family: str = ""
    font_source: str = ""
    font_resolution_status: str = "exact-source"
    edit_capability: str = "exact-editable"
    save_capability: str = "exact-save"
    to_unicode_available: bool = False
    can_embed_for_editing: bool = True
    missing_glyphs: list[str] | None = None
    glyph_run: list[TextGlyphModel] | None = None

    def to_model(self) -> DetectedTextBlockModel:
        is_bold, is_italic = derive_font_traits(self.font_name)
        text_engine_service = TextEngineService()
        text_lines = text_engine_service.build_text_lines(self)
        layout_lines = build_layout_lines_from_spans(self.spans) or [self.text]
        line_height_ratio = derive_line_height_ratio(self.spans, max(self.font_size, 1.0))
        preview_lines = build_preview_lines_from_text_lines(
            text_lines,
            self.bbox,
            self.font_name,
            self.color,
            self.font_size,
        )
        preview_backgrounds = text_engine_service.extract_background_regions_for_block(self.page, self.bbox)
        return DetectedTextBlockModel(
            textBlockId=self.text_block_id,
            pageNumber=self.page_number,
            text=self.text,
            x=self.x,
            y=self.y,
            width=self.width,
            height=self.height,
            fontSize=self.font_size,
            fontName=self.font_name,
            colorHex=rgb_tuple_to_hex(self.color),
            isBold=is_bold,
            isItalic=is_italic,
            renderedFontSize=self.font_size,
            lineHeightRatio=line_height_ratio,
            previewMode="source",
            previewCoordinateSpace="exact-local",
            previewViewportWidth=max(float(self.bbox[2] - self.bbox[0]), 0.0),
            previewViewportHeight=max(float(self.bbox[3] - self.bbox[1]), 0.0),
            layoutContainerId=self.layout_container_id,
            editableRunId=self.editable_run_id or self.text_block_id,
            documentEditMode=self.document_edit_mode,
            pageEditMode=self.page_edit_mode,
            fontResourceName=self.font_resource_name,
            fontPostScriptName=self.font_postscript_name,
            fontFamily=self.font_family or self.font_name,
            fontSource=self.font_source,
            fontResolutionStatus=self.font_resolution_status,
            editCapability=self.edit_capability,
            saveCapability=self.save_capability,
            toUnicodeAvailable=self.to_unicode_available,
            canEmbedForEditing=self.can_embed_for_editing,
            missingGlyphs=list(self.missing_glyphs or []),
            glyphRun=list(self.glyph_run or []),
            layoutLines=layout_lines,
            previewLines=preview_lines,
            previewBackgrounds=preview_backgrounds,
        )


@dataclass(slots=True)
class ResolvedTextStyle:
    font_name: str
    font_size: float
    color: tuple[float, float, float]
    color_hex: str
    is_bold: bool
    is_italic: bool


_shared_font_registry = FontRegistry()


class TextEngineService:
    def __init__(self, font_registry: FontRegistry | None = None) -> None:
        self.font_registry = font_registry or _shared_font_registry

    def build_visual_line_groups_from_spans(self, spans: list[dict]) -> list[dict[str, object]]:
        ordered_spans = sorted(
            spans,
            key=lambda span: (
                float((span.get("bbox") or [0, 0, 0, 0])[1]),
                float((span.get("bbox") or [0, 0, 0, 0])[3]),
                float((span.get("bbox") or [0, 0, 0, 0])[0]),
                int(span.get("_line_index", 0)),
            ),
        )

        visual_line_groups: list[dict[str, object]] = []
        for span in ordered_spans:
            span_bbox = [float(value) for value in (span.get("bbox") or [0, 0, 0, 0])]
            span_top = span_bbox[1]
            span_bottom = span_bbox[3]
            span_height = max(span_bottom - span_top, 0.0)
            span_font_size = float(span.get("size") or 12.0)
            span_center_y = span_top + (span_height / 2.0)

            if visual_line_groups:
                current_group = visual_line_groups[-1]
                current_top = float(current_group["top"])
                current_bottom = float(current_group["bottom"])
                current_height = max(current_bottom - current_top, 0.0)
                current_center_y = float(current_group["center_y"])
                current_font_size = float(current_group["font_size"])
                vertical_overlap = min(span_bottom, current_bottom) - max(span_top, current_top)
                overlap_threshold = max(min(span_height, current_height) * 0.34, 0.0)
                baseline_tolerance = max(span_font_size, current_font_size, 8.0) * 0.42

                if abs(span_center_y - current_center_y) <= baseline_tolerance or vertical_overlap >= overlap_threshold:
                    current_group["spans"].append(span)
                    current_group["top"] = min(current_top, span_top)
                    current_group["bottom"] = max(current_bottom, span_bottom)
                    current_group["center_y"] = (
                        float(current_group["top"]) + float(current_group["bottom"])
                    ) / 2.0
                    current_group["font_size"] = max(current_font_size, span_font_size)
                    continue

            visual_line_groups.append({
                "top": span_top,
                "bottom": span_bottom,
                "center_y": span_center_y,
                "font_size": span_font_size,
                "spans": [span],
            })

        return visual_line_groups

    def extract_background_regions_for_block(
        self,
        page: fitz.Page,
        source_bbox: list[float],
    ) -> list[TextPreviewBackgroundModel]:
        source_rect = fitz.Rect(source_bbox)
        if source_rect.width <= 0 or source_rect.height <= 0:
            return []

        page_rect = page.rect
        candidate_regions: list[tuple[float, TextPreviewBackgroundModel]] = []

        try:
            drawings = page.get_drawings()
        except Exception:
            return []

        for drawing in drawings:
            fill_color = drawing.get("fill")
            fill_opacity = float(drawing.get("fill_opacity", 1.0) or 1.0)
            if fill_color is None or fill_opacity <= 0.01:
                continue

            drawing_rect = drawing.get("rect")
            if drawing_rect is None:
                continue

            candidate_rect = fitz.Rect(drawing_rect)
            if candidate_rect.width <= 0 or candidate_rect.height <= 0:
                continue

            intersection = candidate_rect & source_rect
            if intersection.is_empty or intersection.width <= 0 or intersection.height <= 0:
                continue

            intersection_area = intersection.width * intersection.height
            source_area = max(source_rect.width * source_rect.height, 1.0)
            coverage_ratio = intersection_area / source_area

            if coverage_ratio < 0.18:
                continue

            if candidate_rect.width > page_rect.width * 0.95 and candidate_rect.height > page_rect.height * 0.95:
                continue

            relative_x = (intersection.x0 - source_rect.x0) / max(source_rect.width, 1.0)
            relative_y = (intersection.y0 - source_rect.y0) / max(source_rect.height, 1.0)
            relative_width = intersection.width / max(source_rect.width, 1.0)
            relative_height = intersection.height / max(source_rect.height, 1.0)

            candidate_regions.append((
                coverage_ratio,
                TextPreviewBackgroundModel(
                    x=clamp_unit(relative_x),
                    y=clamp_unit(relative_y),
                    width=clamp_unit(relative_width),
                    height=clamp_unit(relative_height),
                    colorHex=rgb_tuple_to_hex(color_to_rgb_tuple(fill_color)),
                    opacity=max(min(fill_opacity, 1.0), 0.0),
                )
            ))

        candidate_regions.sort(key=lambda entry: entry[0], reverse=True)
        unique_regions: list[TextPreviewBackgroundModel] = []
        seen_keys: set[str] = set()
        for _, region in candidate_regions:
            region_key = f"{region.colorHex}|{region.x:.3f}|{region.y:.3f}|{region.width:.3f}|{region.height:.3f}"
            if region_key in seen_keys:
                continue
            seen_keys.add(region_key)
            unique_regions.append(region)
            if len(unique_regions) >= 4:
                break

        return unique_regions

    def build_chunk_text_block(
        self,
        page: fitz.Page,
        page_number: int,
        spans: list[dict],
        page_rect: fitz.Rect,
    ) -> InternalTextBlock | None:
        if not spans:
            return None

        visual_line_groups = self.build_visual_line_groups_from_spans(spans)

        normalized_segments: list[str] = []
        for group in visual_line_groups:
            line_spans = list(group["spans"])
            ordered_line_spans = sorted(
                line_spans,
                key=lambda span: (
                    float((span.get("bbox") or [0, 0, 0, 0])[0]),
                    float((span.get("origin") or [0, 0])[0]),
                ),
            )

            composed_line_segments: list[str] = []
            previous_right = 0.0
            previous_font_size = 0.0
            has_previous_segment = False

            for span in ordered_line_spans:
                normalized_segment = normalize_text(str(span.get("text", "")))
                if not normalized_segment:
                    continue

                span_bbox = [float(value) for value in (span.get("bbox") or [0, 0, 0, 0])]
                current_font_size = float(span.get("size") or previous_font_size or 12.0)
                gap = span_bbox[0] - previous_right if has_previous_segment else 0.0
                should_insert_space = has_previous_segment and gap > max(current_font_size * 0.22, 2.5)
                if should_insert_space:
                    composed_line_segments.append(" ")

                composed_line_segments.append(normalized_segment)
                previous_right = span_bbox[2]
                previous_font_size = current_font_size
                has_previous_segment = True

            normalized_line = "".join(composed_line_segments).strip()
            if normalized_line:
                normalized_segments.append(normalized_line)

        if not normalized_segments:
            return None

        bbox_candidates = [
            [float(value) for value in (span.get("bbox") or [0, 0, 0, 0])]
            for span in spans
            if span.get("bbox")
        ]
        if not bbox_candidates:
            return None

        x0 = min(bbox[0] for bbox in bbox_candidates)
        y0 = min(bbox[1] for bbox in bbox_candidates)
        x1 = max(bbox[2] for bbox in bbox_candidates)
        y1 = max(bbox[3] for bbox in bbox_candidates)
        bbox = [x0, y0, x1, y1]

        font_name, font_size, color = resolve_dominant_span_style(spans)
        internal_spans: list[InternalTextSpan] = []
        for span in spans:
            span_bbox = [float(value) for value in (span.get("bbox") or [0, 0, 0, 0])]
            origin = span.get("origin") or (span_bbox[0], span_bbox[3])
            internal_spans.append(
                InternalTextSpan(
                    bbox=span_bbox,
                    color=color_to_rgb_tuple(span.get("color")),
                    font_name=str(span.get("font") or "").strip(),
                    font_size=float(span.get("size") or font_size or 12.0),
                    origin_x=float(origin[0]),
                    origin_y=float(origin[1]),
                    text=normalize_editable_text_characters(str(span.get("text") or "")),
                )
            )

        text = "\n".join(normalized_segments)
        normalized_bounds = normalize_bbox(page_rect, bbox)

        return InternalTextBlock(
            bbox=bbox,
            color=color,
            font_name=font_name,
            font_size=font_size,
            page=page,
            page_number=page_number,
            text=text,
            text_block_id=build_text_block_id(page_number, bbox, text, font_size, font_name),
            spans=internal_spans,
            **normalized_bounds,
        )

    def build_chunk_text_blocks(
        self,
        page: fitz.Page,
        page_number: int,
        spans: list[dict],
        page_rect: fitz.Rect,
    ) -> list[InternalTextBlock]:
        if not spans:
            return []

        distinct_styles = {
            build_raw_span_style_key(span)
            for span in spans
            if normalize_text(str(span.get("text", "")))
        }
        if len(distinct_styles) <= 1:
            chunk_text_block = self.build_chunk_text_block(page, page_number, spans, page_rect)
            return [chunk_text_block] if chunk_text_block is not None else []

        split_span_groups: list[list[dict]] = []
        for visual_line_group in self.build_visual_line_groups_from_spans(spans):
            ordered_line_spans = sorted(
                list(visual_line_group["spans"]),
                key=lambda span: (
                    float((span.get("bbox") or [0, 0, 0, 0])[0]),
                    float((span.get("origin") or [0, 0])[0]),
                ),
            )

            current_group: list[dict] = []
            current_style_key: tuple[str, float, tuple[float, float, float]] | None = None

            for span in ordered_line_spans:
                normalized_segment = normalize_text(str(span.get("text", "")))
                if not normalized_segment:
                    continue

                style_key = build_raw_span_style_key(span)
                if current_group and style_key != current_style_key:
                    split_span_groups.append(current_group)
                    current_group = []

                current_group.append(span)
                current_style_key = style_key

            if current_group:
                split_span_groups.append(current_group)

        split_blocks = [
            text_block
            for text_block in (
                self.build_chunk_text_block(page, page_number, span_group, page_rect)
                for span_group in split_span_groups
            )
            if text_block is not None
        ]

        if len(split_blocks) <= 1:
            chunk_text_block = self.build_chunk_text_block(page, page_number, spans, page_rect)
            return [chunk_text_block] if chunk_text_block is not None else []

        return split_blocks

    def should_split_same_visual_row_chunk(
        self,
        previous_line_bbox: list[float] | None,
        current_line_bbox: list[float],
        previous_font_size: float,
        current_font_size: float,
    ) -> bool:
        if previous_line_bbox is None:
            return False

        previous_left = float(previous_line_bbox[0])
        previous_right = float(previous_line_bbox[2])
        current_left = float(current_line_bbox[0])
        current_right = float(current_line_bbox[2])

        previous_width = max(previous_right - previous_left, 0.0)
        current_width = max(current_right - current_left, 0.0)
        horizontal_overlap = min(previous_right, current_right) - max(previous_left, current_left)
        horizontal_gap = max(
            current_left - previous_right,
            previous_left - current_right,
            0.0,
        )

        available_font_sizes = [
            float(font_size)
            for font_size in (previous_font_size, current_font_size)
            if float(font_size or 0.0) > 0.0
        ]
        minimum_font_size = min(available_font_sizes) if available_font_sizes else 0.0
        gap_threshold = max(minimum_font_size * 0.8, 6.0)
        overlap_threshold = max(min(previous_width, current_width) * 0.08, 1.5)

        return horizontal_gap >= gap_threshold and horizontal_overlap <= overlap_threshold

    def normalize_page_range(self, page_range: str | None) -> str | None:
        if page_range is None:
            return None

        normalized = str(page_range).strip()
        if not normalized:
            return None

        segments = [segment.strip() for segment in normalized.split(",") if segment.strip()]
        if not segments:
            return None

        normalized_segments: list[str] = []
        for segment in segments:
            if "-" in segment:
                start_value, end_value, *extra_segments = [part.strip() for part in segment.split("-")]
                if extra_segments or not start_value or not end_value:
                    raise ValueError(f'The page range "{page_range}" is invalid. Use values like 1, 2-4, or 7-9.')

                if not start_value.isdigit() or not end_value.isdigit():
                    raise ValueError(f'The page range "{page_range}" is invalid. Use values like 1, 2-4, or 7-9.')

                start_page = int(start_value)
                end_page = int(end_value)
                if start_page <= 0 or end_page < start_page:
                    raise ValueError(f'The page range "{page_range}" is invalid. Use values like 1, 2-4, or 7-9.')

                normalized_segments.append(f"{start_page}-{end_page}")
                continue

            if not segment.isdigit() or int(segment) <= 0:
                raise ValueError(f'The page range "{page_range}" is invalid. Use values like 1, 2-4, or 7-9.')

            normalized_segments.append(str(int(segment)))

        return ",".join(normalized_segments)

    def normalize_language_codes(self, language_code: str) -> list[str]:
        normalized_value = (language_code or "eng").strip()
        if not normalized_value:
            normalized_value = "eng"

        language_codes = [
            segment.strip()
            for segment in normalized_value.replace("+", ",").split(",")
            if segment.strip()
        ]

        if not language_codes:
            raise ValueError("Choose at least one OCR language before running OCR.")

        for code in language_codes:
            if not code.replace("_", "").replace("-", "").isalnum():
                raise ValueError(f'The OCR language "{code}" is invalid.')

        return language_codes

    def classify_page_edit_mode(self, page: fitz.Page, traces: list[dict] | None = None) -> str:
        page_traces = traces if traces is not None else page.get_texttrace()
        has_visible_text = any(
            int(trace.get("type", 0) or 0) <= 1
            and float(trace.get("opacity", 1.0) or 1.0) > 0.0
            and bool(trace.get("chars"))
            for trace in page_traces
        )
        has_images = bool(page.get_images(full=True))
        if has_visible_text and has_images:
            return "mixed"
        if has_visible_text:
            return "digital-text"
        if has_images:
            return "scanned-ocr"
        return "digital-text"

    def classify_document_edit_mode(self, document: fitz.Document) -> str:
        page_modes = {
            self.classify_page_edit_mode(document[page_index])
            for page_index in range(document.page_count)
        }
        if len(page_modes) == 1:
            return next(iter(page_modes))
        if "mixed" in page_modes or ("digital-text" in page_modes and "scanned-ocr" in page_modes):
            return "mixed"
        return next(iter(page_modes), "digital-text")

    def build_trace_glyph_run(
        self,
        trace: dict,
    ) -> tuple[str, list[TextGlyphModel]]:
        text_segments: list[str] = []
        glyph_run: list[TextGlyphModel] = []
        for raw_char in trace.get("chars", []) or []:
            if not isinstance(raw_char, (list, tuple)) or len(raw_char) < 4:
                continue

            code_point = int(raw_char[0] or 0)
            glyph_id = int(raw_char[1] or 0)
            origin = raw_char[2] or (0.0, 0.0)
            bbox = raw_char[3] or (origin[0], origin[1], origin[0], origin[1])
            unicode_text = ""
            if 0 < code_point <= 0x10FFFF:
                try:
                    unicode_text = chr(code_point)
                except ValueError:
                    unicode_text = ""
            unicode_text = normalize_editable_text_characters(unicode_text)
            glyph_run.append(
                TextGlyphModel(
                    unicodeText=unicode_text,
                    codePoint=code_point,
                    glyphId=glyph_id,
                    originX=float(origin[0] or 0.0),
                    originY=float(origin[1] or 0.0),
                    x=float(bbox[0] or 0.0),
                    y=float(bbox[1] or 0.0),
                    width=max(float(bbox[2] or 0.0) - float(bbox[0] or 0.0), 0.0),
                    height=max(float(bbox[3] or 0.0) - float(bbox[1] or 0.0), 0.0),
                )
            )
            text_segments.append(unicode_text)

        recovered_text = normalize_editable_text_characters("".join(text_segments))
        return recovered_text, apply_recovered_text_to_glyph_run(glyph_run, recovered_text)

    def build_trace_text_block(
        self,
        document: fitz.Document,
        page: fitz.Page,
        page_number: int,
        page_rect: fitz.Rect,
        trace: dict,
        document_edit_mode: str,
        page_edit_mode: str,
    ) -> InternalTextBlock | None:
        trace_bbox = [float(value) for value in (trace.get("bbox") or [0.0, 0.0, 0.0, 0.0])]
        if max(trace_bbox[2] - trace_bbox[0], 0.0) <= 0.0 or max(trace_bbox[3] - trace_bbox[1], 0.0) <= 0.0:
            return None

        text, glyph_run = self.build_trace_glyph_run(trace)
        if not normalize_text(text):
            return None

        trace_font_name = str(trace.get("font") or "").strip()
        trace_font_size = float(trace.get("size") or 0.0) or 12.0
        trace_color = color_to_rgb_tuple(trace.get("color"))
        trace_is_bold, trace_is_italic = derive_font_traits(trace_font_name)
        font_reference = self.font_registry.resolve_source_font_reference(
            document,
            page,
            trace_font_name,
            trace_is_bold,
            trace_is_italic,
            source_font_family=trace_font_name,
        )

        font_resource_name = font_reference.resource_name if font_reference is not None else ""
        font_postscript_name = font_reference.postscript_name if font_reference is not None else ""
        font_family = font_reference.family_name if font_reference is not None else normalize_font_family_name(trace_font_name)
        display_font_name = (
            font_reference.full_name
            if font_reference is not None and font_reference.full_name
            else font_postscript_name or trace_font_name
        )
        font_source = "embedded" if font_reference is not None and font_reference.font_data else "unresolved-source"
        font_resolution_status = "exact-source"
        edit_capability = "exact-editable"
        save_capability = "exact-save"
        to_unicode_available = bool(font_reference.to_unicode_available) if font_reference is not None else False
        can_embed_for_editing = bool(font_reference.can_embed_for_editing) if font_reference is not None else False
        missing_glyphs = []

        if font_reference is None:
            font_resolution_status = "source-unresolved"
            edit_capability = "limited-editable"
            save_capability = "blocked"
        elif not font_reference.font_data:
            font_resolution_status = "source-font-unavailable"
            edit_capability = "move-only"
            save_capability = "blocked"
        elif not font_reference.to_unicode_available:
            font_resolution_status = "missing-tounicode"
            edit_capability = "limited-editable"
            save_capability = "blocked"
        elif not font_reference.can_embed_for_editing:
            font_resolution_status = "source-embedding-restricted"
            edit_capability = "limited-editable"
            save_capability = "blocked"

        first_glyph = glyph_run[0] if glyph_run else None
        baseline_y = float(first_glyph.originY if first_glyph is not None else trace_bbox[3])
        layout_container_id = f"page-{page_number}:baseline-{round(baseline_y, 1)}"
        text_block_id = build_text_block_id(
            page_number,
            trace_bbox,
            text,
            trace_font_size,
            display_font_name,
            seqno=int(trace.get("seqno") or 0),
            font_resource_name=font_resource_name,
        )
        normalized_bounds = normalize_bbox(page_rect, trace_bbox)
        internal_span = InternalTextSpan(
            bbox=trace_bbox,
            color=trace_color,
            font_name=display_font_name,
            font_size=trace_font_size,
            origin_x=float(first_glyph.originX if first_glyph is not None else trace_bbox[0]),
            origin_y=baseline_y,
            text=text,
            glyph_run=glyph_run,
            font_resource_name=font_resource_name,
            font_postscript_name=font_postscript_name,
            font_family=font_family,
            font_source=font_source,
            font_resolution_status=font_resolution_status,
            to_unicode_available=to_unicode_available,
            can_embed_for_editing=can_embed_for_editing,
            missing_glyphs=missing_glyphs,
        )
        return InternalTextBlock(
            bbox=trace_bbox,
            color=trace_color,
            font_name=display_font_name,
            font_size=trace_font_size,
            page=page,
            page_number=page_number,
            text=text,
            text_block_id=text_block_id,
            x=normalized_bounds["x"],
            y=normalized_bounds["y"],
            width=normalized_bounds["width"],
            height=normalized_bounds["height"],
            spans=[internal_span],
            layout_container_id=layout_container_id,
            editable_run_id=text_block_id,
            document_edit_mode=document_edit_mode,
            page_edit_mode=page_edit_mode,
            font_resource_name=font_resource_name,
            font_postscript_name=font_postscript_name,
            font_family=font_family,
            font_source=font_source,
            font_resolution_status=font_resolution_status,
            edit_capability=edit_capability,
            save_capability=save_capability,
            to_unicode_available=to_unicode_available,
            can_embed_for_editing=can_embed_for_editing,
            missing_glyphs=missing_glyphs,
            glyph_run=glyph_run,
        )

    def iterate_text_blocks(self, document: fitz.Document):
        document_edit_mode = self.classify_document_edit_mode(document)
        for page_index in range(document.page_count):
            page = document[page_index]
            page_rect = page.rect
            traces = page.get_texttrace()
            page_edit_mode = self.classify_page_edit_mode(page, traces)

            for trace in traces:
                if int(trace.get("type", 0) or 0) > 1:
                    continue
                trace_text_block = self.build_trace_text_block(
                    document,
                    page,
                    page_index + 1,
                    page_rect,
                    trace,
                    document_edit_mode,
                    page_edit_mode,
                )
                if trace_text_block is not None:
                    yield trace_text_block

    def extract_text_blocks(self, source_path: str) -> list[DetectedTextBlockModel]:
        input_path = ensure_existing_file(source_path)
        document = fitz.open(input_path)
        try:
            return [text_block.to_model() for text_block in self.iterate_text_blocks(document)]
        finally:
            document.close()

    def resolve_builtin_font_name(
        self,
        font_name: str,
        is_bold: bool | None = None,
        is_italic: bool | None = None,
    ) -> str:
        lower_name = (font_name or "").lower()
        resolved_is_bold = (
            is_bold
            if is_bold is not None
            else ("bold" in lower_name or "black" in lower_name or "semibold" in lower_name or "demi" in lower_name)
        )
        resolved_is_italic = (
            is_italic
            if is_italic is not None
            else ("italic" in lower_name or "oblique" in lower_name)
        )

        if any(token in lower_name for token in ("times", "roman", "serif", "georgia", "garamond", "cambria")):
            if resolved_is_bold and resolved_is_italic:
                return "Times-BoldItalic"
            if resolved_is_bold:
                return "Times-Bold"
            if resolved_is_italic:
                return "Times-Italic"
            return "Times-Roman"

        if any(token in lower_name for token in ("courier", "mono", "consola", "code", "menlo")):
            if resolved_is_bold and resolved_is_italic:
                return "Courier-BoldOblique"
            if resolved_is_bold:
                return "Courier-Bold"
            if resolved_is_italic:
                return "Courier-Oblique"
            return "Courier"

        if resolved_is_bold and resolved_is_italic:
            return "Helvetica-BoldOblique"
        if resolved_is_bold:
            return "Helvetica-Bold"
        if resolved_is_italic:
            return "Helvetica-Oblique"
        return "Helvetica"

    @staticmethod
    def get_document_for_page(page: fitz.Page | None) -> fitz.Document | None:
        return getattr(page, "parent", None) if page is not None else None

    def resolve_font_resource(
        self,
        page: fitz.Page | None,
        font_name: str,
        is_bold: bool | None = None,
        is_italic: bool | None = None,
        text_sample: str | None = None,
        source_font_resource_name: str | None = None,
        source_font_postscript_name: str | None = None,
        source_font_family: str | None = None,
    ) -> ResolvedFontResource:
        document = self.get_document_for_page(page)
        return self.font_registry.resolve_font_resource(
            document,
            page,
            font_name,
            is_bold,
            is_italic,
            text_sample=text_sample,
            source_font_resource_name=source_font_resource_name,
            source_font_postscript_name=source_font_postscript_name,
            source_font_family=source_font_family,
        )

    def measure_text_width(
        self,
        text: str,
        page: fitz.Page | None,
        font_name: str,
        font_size: float,
        is_bold: bool | None = None,
        is_italic: bool | None = None,
    ) -> float:
        return self.font_registry.measure_text(
            text,
            font_name,
            font_size,
            document=self.get_document_for_page(page),
            page=page,
            is_bold=is_bold,
            is_italic=is_italic,
        )

    def insert_text_with_resolved_font(
        self,
        page: fitz.Page,
        point: fitz.Point,
        text: str,
        font_name: str,
        font_size: float,
        color: tuple[float, float, float],
        is_bold: bool | None = None,
        is_italic: bool | None = None,
        source_font_resource_name: str | None = None,
        source_font_postscript_name: str | None = None,
        source_font_family: str | None = None,
    ) -> ResolvedFontResource:
        font_resource = self.resolve_font_resource(
            page,
            font_name,
            is_bold,
            is_italic,
            text_sample=text,
            source_font_resource_name=source_font_resource_name,
            source_font_postscript_name=source_font_postscript_name,
            source_font_family=source_font_family,
        )
        inserted_font_alias = self.font_registry.ensure_page_font_alias(page, font_resource)
        insert_arguments = {
            "fontsize": max(float(font_size or 0.0), 6.0),
            "fontname": inserted_font_alias,
            "color": color,
        }
        if font_resource.font_file_path:
            insert_arguments["fontfile"] = font_resource.font_file_path

        page.insert_text(point, text, **insert_arguments)
        return font_resource

    def insert_textbox_with_resolved_font(
        self,
        page: fitz.Page,
        rect: fitz.Rect,
        text: str,
        font_name: str,
        font_size: float,
        color: tuple[float, float, float],
        is_bold: bool | None = None,
        is_italic: bool | None = None,
        source_font_resource_name: str | None = None,
        source_font_postscript_name: str | None = None,
        source_font_family: str | None = None,
    ) -> tuple[float | int, ResolvedFontResource]:
        font_resource = self.resolve_font_resource(
            page,
            font_name,
            is_bold,
            is_italic,
            text_sample=text,
            source_font_resource_name=source_font_resource_name,
            source_font_postscript_name=source_font_postscript_name,
            source_font_family=source_font_family,
        )
        inserted_font_alias = self.font_registry.ensure_page_font_alias(page, font_resource)
        insert_arguments = {
            "fontsize": max(float(font_size or 0.0), 6.0),
            "fontname": inserted_font_alias,
            "color": color,
            "align": fitz.TEXT_ALIGN_LEFT,
        }
        if font_resource.font_file_path:
            insert_arguments["fontfile"] = font_resource.font_file_path

        result = page.insert_textbox(rect, text, **insert_arguments)
        return result, font_resource

    def resolve_text_style(
        self,
        source_text_block: InternalTextBlock,
        font_name: str | None = None,
        font_size: float | None = None,
        color_hex: str | None = None,
        is_bold: bool | None = None,
        is_italic: bool | None = None,
    ) -> ResolvedTextStyle:
        primary_span = next((span for span in source_text_block.spans if span.text.strip()), None)
        default_font_name = (primary_span.font_name if primary_span else source_text_block.font_name) or source_text_block.font_name
        default_font_size = max(float(primary_span.font_size if primary_span else source_text_block.font_size or 12.0), 8.0)
        default_color = (primary_span.color if primary_span else source_text_block.color) or source_text_block.color
        default_is_bold, default_is_italic = derive_font_traits(default_font_name)

        resolved_font_name = (font_name or "").strip() or default_font_name
        resolved_font_size = max(float(font_size if font_size and font_size > 0 else default_font_size), 6.0)
        resolved_is_bold = default_is_bold if is_bold is None else bool(is_bold)
        resolved_is_italic = default_is_italic if is_italic is None else bool(is_italic)
        resolved_color = color_hex_to_rgb_tuple(color_hex, default_color)

        return ResolvedTextStyle(
            font_name=resolved_font_name,
            font_size=resolved_font_size,
            color=resolved_color,
            color_hex=rgb_tuple_to_hex(resolved_color),
            is_bold=resolved_is_bold,
            is_italic=resolved_is_italic,
        )

    def style_matches_source_text_block(self, source_text_block: InternalTextBlock, style: ResolvedTextStyle) -> bool:
        source_is_bold, source_is_italic = derive_font_traits(source_text_block.font_name)
        return (
            style.font_name == source_text_block.font_name
            and abs(style.font_size - max(float(source_text_block.font_size or 12.0), 8.0)) < 0.01
            and style.color_hex.lower() == rgb_tuple_to_hex(source_text_block.color).lower()
            and style.is_bold == source_is_bold
            and style.is_italic == source_is_italic
        )

    def calculate_font_size(
        self,
        text: str,
        rect: fitz.Rect,
        original_font_size: float,
        font_name: str,
        page: fitz.Page | None = None,
        is_bold: bool | None = None,
        is_italic: bool | None = None,
    ) -> float:
        if not text.strip():
            return max(original_font_size, 8.0)

        maximum_width = max(rect.width - 3.0, 10.0)
        next_font_size = max(original_font_size, 8.0)
        measured_width = self.measure_text_width(
            text.replace("\n", " "),
            page,
            font_name,
            next_font_size,
            is_bold,
            is_italic,
        )

        if measured_width > maximum_width and measured_width > 0:
            next_font_size *= maximum_width / measured_width

        return max(min(next_font_size, original_font_size), 6.0)

    def ensure_text_rect(self, target_rect: fitz.Rect, page_rect: fitz.Rect, minimum_font_size: float) -> fitz.Rect:
        rect = fitz.Rect(target_rect)
        minimum_height = max(minimum_font_size * 1.65, 14.0)
        minimum_width = max(rect.width, 18.0)

        if rect.height < minimum_height:
            rect.y1 = min(rect.y0 + minimum_height, page_rect.y1)

        if rect.width < minimum_width:
            rect.x1 = min(rect.x0 + minimum_width, page_rect.x1)

        if rect.y1 <= rect.y0:
            rect.y0 = max(page_rect.y0, rect.y1 - minimum_height)

        if rect.x1 <= rect.x0:
            rect.x0 = max(page_rect.x0, rect.x1 - minimum_width)

        return rect

    def insert_text_with_fallback(
        self,
        page: fitz.Page,
        rect: fitz.Rect,
        text: str,
        font_size: float,
        font_name: str,
        color: tuple[float, float, float],
        *,
        is_bold: bool | None = None,
        is_italic: bool | None = None,
        preserve_font_size: bool = False,
    ) -> None:
        normalized_text = text or ""
        if not normalized_text.strip():
            return

        safe_rect = self.ensure_text_rect(rect, page.rect, font_size)
        candidate_font_size = (
            max(font_size, 8.0)
            if preserve_font_size
            else self.calculate_font_size(
                normalized_text,
                safe_rect,
                max(font_size, 8.0),
                font_name,
                page,
                is_bold,
                is_italic,
            )
        )

        for scale in (1.0, 0.96, 0.92, 0.88, 0.82, 0.76, 0.68):
            next_font_size = max(candidate_font_size * scale, 6.0)
            result, _ = self.insert_textbox_with_resolved_font(
                page,
                safe_rect,
                normalized_text,
                font_name,
                next_font_size,
                color,
                is_bold,
                is_italic,
            )
            if isinstance(result, (int, float)) and result >= -0.5:
                return

        fallback_font_size = max(min(candidate_font_size, safe_rect.height - 1.0), 6.0)
        baseline = fitz.Point(safe_rect.x0, safe_rect.y0 + fallback_font_size)
        self.insert_text_with_resolved_font(
            page,
            baseline,
            normalized_text,
            font_name,
            fallback_font_size,
            color,
            is_bold,
            is_italic,
        )

    def is_single_line_text_block(self, text_block: InternalTextBlock) -> bool:
        if not text_block.spans:
            return False

        origin_buckets = {
            round(float(span.origin_y), 1)
            for span in text_block.spans
            if span.text.strip()
        }
        return len(origin_buckets) <= 1

    def build_text_lines(self, text_block: InternalTextBlock) -> list[InternalTextLine]:
        grouped_lines: dict[float, list[InternalTextSpan]] = {}
        for span in text_block.spans:
            if not span.text.strip():
                continue

            line_key = round(float(span.origin_y), 1)
            grouped_lines.setdefault(line_key, []).append(span)

        text_lines: list[InternalTextLine] = []
        for baseline_y, spans in grouped_lines.items():
            ordered_spans = sorted(spans, key=lambda span: (span.origin_x, span.origin_y))
            x0 = min(span.bbox[0] for span in ordered_spans)
            y0 = min(span.bbox[1] for span in ordered_spans)
            x1 = max(span.bbox[2] for span in ordered_spans)
            y1 = max(span.bbox[3] for span in ordered_spans)
            text_lines.append(
                InternalTextLine(
                    baseline_y=float(baseline_y),
                    bbox=[x0, y0, x1, y1],
                    spans=ordered_spans,
                )
            )

        return sorted(text_lines, key=lambda line: line.baseline_y)

    def wrap_text_to_lines(
        self,
        text: str,
        font_name: str,
        font_size: float,
        max_width: float,
        page: fitz.Page | None = None,
        is_bold: bool | None = None,
        is_italic: bool | None = None,
    ) -> list[str]:
        normalized_text = text or ""
        if not normalized_text.strip():
            return []

        paragraphs = normalized_text.replace("\r\n", "\n").split("\n")
        wrapped_lines: list[str] = []
        safe_width = max(max_width, 12.0)

        for paragraph in paragraphs:
            words = paragraph.split()
            if not words:
                wrapped_lines.append("")
                continue

            current_line = words[0]
            for word in words[1:]:
                candidate = f"{current_line} {word}"
                candidate_width = self.measure_text_width(
                    candidate,
                    page,
                    font_name,
                    font_size,
                    is_bold,
                    is_italic,
                )
                if candidate_width <= safe_width:
                    current_line = candidate
                    continue

                wrapped_lines.append(current_line)
                current_line = word

            wrapped_lines.append(current_line)

        return wrapped_lines

    def preview_single_line_layout(
        self,
        source_text_block: InternalTextBlock,
        source_rect: fitz.Rect,
        target_rect: fitz.Rect,
        text: str,
        style: ResolvedTextStyle,
    ) -> tuple[list[str], float, float, list[TextPreviewLineModel], fitz.Rect]:
        normalized_text = normalize_editable_text_characters(text).replace("\r\n", "\n")
        source_lines = self.build_text_lines(source_text_block)
        source_line = source_lines[0] if source_lines else None
        font_size = max(style.font_size, 8.0)
        safe_target_rect = self.ensure_text_rect(target_rect, source_text_block.page.rect, font_size)
        preview_spans = self.build_single_line_preview_spans(
            source_line,
            source_text_block.bbox,
            normalized_text,
            font_size,
            style,
            source_text_block.page,
        )
        vertical_scale = safe_target_rect.height / max(source_rect.height, 1.0)
        fitted_font_size = max(
            (
                max(float(span.fontSize or 0.0), 0.0)
                for span in preview_spans
                if span.text is not None
            ),
            default=font_size,
        )
        measured_width = max(
            (
                max(float(span.x or 0.0), 0.0)
                + self.measure_preview_text_width(
                    span.text,
                    span.fontName,
                    float(span.fontSize or 8.0),
                    bool(span.isBold),
                    bool(span.isItalic),
                    source_text_block.page,
                )
                for span in preview_spans
                if span.text is not None
            ),
            default=0.0,
        )
        preview_width = max(safe_target_rect.width, measured_width + 1.0)
        effective_preview_rect = fitz.Rect(
            safe_target_rect.x0,
            safe_target_rect.y0,
            min(safe_target_rect.x0 + preview_width, source_text_block.page.rect.x1),
            safe_target_rect.y1,
        )

        if source_line is not None:
            baseline_y = max(float(source_line.baseline_y - source_rect.y0) * vertical_scale, fitted_font_size)
        else:
            baseline_y = fitted_font_size
        baseline_y = min(max(baseline_y, fitted_font_size), max(safe_target_rect.height - 1.0, fitted_font_size))
        preview_top_y = max(baseline_y - fitted_font_size, 0.0)

        preview_line = TextPreviewLineModel(
            text=normalized_text,
            x=0.0,
            y=preview_top_y,
            baselineY=baseline_y,
            fontSize=fitted_font_size,
            fontName=style.font_name,
            colorHex=style.color_hex,
            isBold=style.is_bold,
            isItalic=style.is_italic,
            spans=preview_spans,
        )
        line_height_ratio = derive_line_height_ratio(source_text_block.spans, max(source_text_block.font_size, 1.0))
        return [normalized_text], fitted_font_size, line_height_ratio, [preview_line], effective_preview_rect

    def build_single_line_preview_spans(
        self,
        source_line: InternalTextLine | None,
        source_bbox: list[float],
        text: str,
        font_size: float,
        style: ResolvedTextStyle,
        page: fitz.Page | None = None,
    ) -> list[TextPreviewSpanModel]:
        if source_line is None:
            return [self.build_default_preview_span(text, 0.0, font_size, style, page)]

        ordered_spans = [span for span in source_line.spans if span.text]
        if not ordered_spans:
            return [self.build_default_preview_span(text, 0.0, font_size, style, page)]

        source_x0 = float(source_bbox[0])
        source_visual_segments = build_visual_line_segments_from_internal_spans(ordered_spans, source_x0)
        original_text = compose_visual_line_text_from_segments(source_visual_segments)
        if not original_text:
            return [self.build_default_preview_span(text, 0.0, font_size, style, page)]

        prefix_length = 0
        max_prefix = min(len(original_text), len(text))
        while prefix_length < max_prefix and original_text[prefix_length] == text[prefix_length]:
            prefix_length += 1

        suffix_length = 0
        max_suffix = min(len(original_text) - prefix_length, len(text) - prefix_length)
        while suffix_length < max_suffix and original_text[-(suffix_length + 1)] == text[-(suffix_length + 1)]:
            suffix_length += 1

        changed_source_segments = self.extract_source_visual_segments(
            source_visual_segments,
            prefix_length,
            max(len(original_text) - suffix_length, prefix_length),
            page,
        )

        if prefix_length == 0 and suffix_length == 0:
            changed_style = self.resolve_changed_preview_style(changed_source_segments, font_size, style)
            return [
                TextPreviewSpanModel(
                    text=text,
                    x=min(
                        (
                            max(float(segment.get("x") or 0.0), 0.0)
                            for segment in source_visual_segments
                            if not bool(segment.get("is_synthetic_gap"))
                        ),
                        default=0.0,
                    ),
                    width=max(self.measure_preview_text_width(
                        text,
                        changed_style["font_name"],
                        changed_style["font_size"],
                        changed_style["is_bold"],
                        changed_style["is_italic"],
                        page,
                    ), 0.0),
                    fontSize=changed_style["font_size"],
                    fontName=changed_style["font_name"],
                    colorHex=changed_style["color_hex"],
                    isBold=changed_style["is_bold"],
                    isItalic=changed_style["is_italic"],
                )
            ]

        preview_spans: list[TextPreviewSpanModel] = []

        prefix_segments = self.extract_source_visual_segments(source_visual_segments, 0, prefix_length, page)
        suffix_segments = self.extract_source_visual_segments(
            source_visual_segments,
            max(len(original_text) - suffix_length, 0),
            len(original_text),
            page,
        )

        def append_preserved_segment(segment: dict[str, object]) -> None:
            segment_text = str(segment.get("text") or "")
            if not segment_text or bool(segment.get("is_synthetic_gap")):
                return

            preview_spans.append(
                TextPreviewSpanModel(
                    text=segment_text,
                    x=max(float(segment.get("x") or 0.0), 0.0),
                    width=max(float(segment.get("width") or 0.0), 0.0),
                    fontSize=max(float(segment.get("font_size") or font_size), 6.0),
                    fontName=str(segment.get("font_name") or style.font_name),
                    colorHex=str(segment.get("color_hex") or style.color_hex),
                    isBold=bool(segment.get("is_bold")),
                    isItalic=bool(segment.get("is_italic")),
                )
            )

        for segment in prefix_segments:
            append_preserved_segment(segment)

        changed_start = prefix_length
        changed_end = len(text) - suffix_length if suffix_length > 0 else len(text)
        changed_text = text[changed_start:changed_end]
        if changed_text:
            changed_style = self.resolve_changed_preview_style(changed_source_segments, font_size, style)
            changed_anchor_x = min(
                (
                    max(float(segment.get("x") or 0.0), 0.0)
                    for segment in changed_source_segments
                    if not bool(segment.get("is_synthetic_gap"))
                ),
                default=max(
                    (
                        max(float(span.x or 0.0), 0.0) + max(float(span.width or 0.0), 0.0)
                        for span in preview_spans
                    ),
                    default=0.0,
                ),
            )
            preview_spans.append(
                TextPreviewSpanModel(
                    text=changed_text,
                    x=changed_anchor_x,
                    width=max(self.measure_preview_text_width(
                        changed_text,
                        changed_style["font_name"],
                        changed_style["font_size"],
                        changed_style["is_bold"],
                        changed_style["is_italic"],
                        page,
                    ), 0.0),
                    fontSize=changed_style["font_size"],
                    fontName=changed_style["font_name"],
                    colorHex=changed_style["color_hex"],
                    isBold=changed_style["is_bold"],
                    isItalic=changed_style["is_italic"],
                )
            )

        for segment in suffix_segments:
            append_preserved_segment(segment)

        preview_spans.sort(key=lambda preview_span: (max(float(preview_span.x or 0.0), 0.0), preview_span.text or ""))

        return preview_spans or [self.build_default_preview_span(text, 0.0, font_size, style, page)]

    def extract_source_visual_segments(
        self,
        source_visual_segments: list[dict[str, object]],
        start_index: int,
        end_index: int,
        page: fitz.Page | None = None,
    ) -> list[dict[str, object]]:
        if end_index <= start_index:
            return []

        extracted_segments: list[dict[str, object]] = []
        current_index = 0
        for segment in source_visual_segments:
            segment_text = str(segment.get("text") or "")
            if not segment_text:
                continue

            segment_end = current_index + len(segment_text)
            if segment_end <= start_index:
                current_index = segment_end
                continue
            if current_index >= end_index:
                break

            local_start = max(start_index - current_index, 0)
            local_end = min(end_index - current_index, len(segment_text))
            if local_end <= local_start:
                current_index = segment_end
                continue

            sliced_text = segment_text[local_start:local_end]
            if not sliced_text:
                current_index = segment_end
                continue

            segment_is_gap = bool(segment.get("is_synthetic_gap"))
            segment_font_name = str(segment.get("font_name") or "")
            segment_font_size = max(float(segment.get("font_size") or 8.0), 6.0)
            segment_is_bold = bool(segment.get("is_bold"))
            segment_is_italic = bool(segment.get("is_italic"))
            segment_x = max(float(segment.get("x") or 0.0), 0.0)
            if segment_is_gap:
                segment_width = max(float(segment.get("width") or 0.0), 0.0)
                if len(segment_text) > 0:
                    unit_width = segment_width / len(segment_text)
                    segment_x += unit_width * local_start
                    sliced_width = unit_width * len(sliced_text)
                else:
                    sliced_width = 0.0
            else:
                prefix_text = segment_text[:local_start]
                if prefix_text:
                    segment_x += self.measure_preview_text_width(
                        prefix_text,
                        segment_font_name,
                        segment_font_size,
                        segment_is_bold,
                        segment_is_italic,
                        page,
                    )
                sliced_width = self.measure_preview_text_width(
                    sliced_text,
                    segment_font_name,
                    segment_font_size,
                    segment_is_bold,
                    segment_is_italic,
                    page,
                )

            extracted_segments.append(
                {
                    "text": sliced_text,
                    "x": segment_x,
                    "width": max(sliced_width, 0.0),
                    "font_size": segment_font_size,
                    "font_name": segment_font_name,
                    "color_hex": str(segment.get("color_hex") or "#000000"),
                    "is_bold": segment_is_bold,
                    "is_italic": segment_is_italic,
                    "is_synthetic_gap": segment_is_gap,
                }
            )
            current_index = segment_end

        return extracted_segments

    def measure_preview_line_width(self, preview_spans: list[TextPreviewSpanModel]) -> float:
        if not preview_spans:
            return 0.0

        return max(
            (
                max(float(span.x or 0.0), 0.0)
                + self.measure_preview_text_width(
                    span.text,
                    span.fontName,
                    float(span.fontSize or 8.0),
                    bool(span.isBold),
                    bool(span.isItalic),
                    None,
                )
                for span in preview_spans
                if span.text is not None
            ),
            default=0.0,
        )

    def scale_preview_spans(
        self,
        preview_spans: list[TextPreviewSpanModel],
        scale_factor: float,
    ) -> list[TextPreviewSpanModel]:
        if not preview_spans or abs(scale_factor - 1.0) < 0.001:
            return preview_spans

        safe_scale_factor = max(float(scale_factor), 0.2)
        return [
            TextPreviewSpanModel(
                text=span.text,
                x=max(float(span.x or 0.0) * safe_scale_factor, 0.0),
                width=max(float(span.width or 0.0) * safe_scale_factor, 0.0),
                fontSize=max(float(span.fontSize or 8.0) * safe_scale_factor, 6.0),
                fontName=span.fontName,
                colorHex=span.colorHex,
                isBold=bool(span.isBold),
                isItalic=bool(span.isItalic),
            )
            for span in preview_spans
        ]

    def resolve_changed_preview_style(
        self,
        changed_source_segments: list[dict[str, object]],
        font_size: float,
        fallback_style: ResolvedTextStyle,
    ) -> dict[str, object]:
        if not changed_source_segments:
            return {
                "font_size": max(float(font_size), 6.0),
                "font_name": fallback_style.font_name,
                "color_hex": fallback_style.color_hex,
                "is_bold": fallback_style.is_bold,
                "is_italic": fallback_style.is_italic,
            }

        preferred_segment = max(
            changed_source_segments,
            key=lambda segment: len(str(segment.get("text") or "").strip()) or 0,
        )
        return {
            "font_size": max(float(preferred_segment.get("font_size") or font_size), 6.0),
            "font_name": str(preferred_segment.get("font_name") or fallback_style.font_name),
            "color_hex": str(preferred_segment.get("color_hex") or fallback_style.color_hex),
            "is_bold": bool(preferred_segment.get("is_bold", fallback_style.is_bold)),
            "is_italic": bool(preferred_segment.get("is_italic", fallback_style.is_italic)),
        }

    def build_default_preview_span(
        self,
        text: str,
        x: float,
        font_size: float,
        style: ResolvedTextStyle,
        page: fitz.Page | None = None,
    ) -> TextPreviewSpanModel:
        return TextPreviewSpanModel(
            text=text,
            x=max(float(x), 0.0),
            width=max(self.measure_preview_text_width(
                text,
                style.font_name,
                font_size,
                style.is_bold,
                style.is_italic,
                page,
            ), 0.0),
            fontSize=max(font_size, 6.0),
            fontName=style.font_name,
            colorHex=style.color_hex,
            isBold=style.is_bold,
            isItalic=style.is_italic,
        )

    def measure_preview_text_width(
        self,
        text: str,
        font_name: str,
        font_size: float,
        is_bold: bool,
        is_italic: bool,
        page: fitz.Page | None = None,
    ) -> float:
        if not text:
            return 0.0

        return max(
            self.measure_text_width(
                text,
                page,
                font_name,
                max(float(font_size or 0.0), 6.0),
                is_bold,
                is_italic,
            ),
            0.0,
        )

    def extract_source_span_segments(
        self,
        ordered_spans: list[InternalTextSpan],
        start_index: int,
        end_index: int,
    ) -> list[dict[str, object]]:
        if end_index <= start_index:
            return []

        segments: list[dict[str, object]] = []
        current_index = 0
        for span in ordered_spans:
            span_text = span.text or ""
            if not span_text:
                continue

            span_end = current_index + len(span_text)
            if span_end <= start_index:
                current_index = span_end
                continue
            if current_index >= end_index:
                break

            local_start = max(start_index - current_index, 0)
            local_end = min(end_index - current_index, len(span_text))
            if local_end <= local_start:
                current_index = span_end
                continue

            segment_text = span_text[local_start:local_end]
            if segment_text:
                segment_is_bold, segment_is_italic = derive_font_traits(span.font_name)
                segments.append(
                    {
                        "text": segment_text,
                        "font_size": max(float(span.font_size or 0.0), 6.0),
                        "font_name": span.font_name,
                        "color_hex": rgb_tuple_to_hex(span.color),
                        "is_bold": segment_is_bold,
                        "is_italic": segment_is_italic,
                    }
                )

            current_index = span_end

        return segments

    def preview_multiline_layout(
        self,
        source_text_block: InternalTextBlock,
        target_rect: fitz.Rect,
        text: str,
        style: ResolvedTextStyle,
    ) -> tuple[list[str], float, float, list[TextPreviewLineModel], fitz.Rect]:
        normalized_text = normalize_editable_text_characters(text or "")
        source_lines = self.build_text_lines(source_text_block)
        source_rect = fitz.Rect(source_text_block.bbox)
        source_preview_lines = build_preview_lines_from_text_lines(
            source_lines,
            source_text_block.bbox,
            source_text_block.font_name,
            source_text_block.color,
            source_text_block.font_size,
        )
        requested_lines = normalized_text.replace("\r\n", "\n").split("\n")
        has_explicit_line_breaks = "\n" in normalized_text.replace("\r\n", "\n").replace("\r", "\n")
        if has_explicit_line_breaks:
            if len(source_lines) > 1:
                source_line_heights = [max(line.bbox[3] - line.bbox[1], source_text_block.font_size * 1.1) for line in source_lines]
                source_line_spacing = [
                    max(source_lines[index + 1].baseline_y - source_lines[index].baseline_y, source_line_heights[index])
                    for index in range(len(source_lines) - 1)
                ]
                average_spacing = sum(source_line_spacing) / len(source_line_spacing) if source_line_spacing else max(float(source_text_block.font_size or 12.0) * 1.25, 14.0)
            else:
                average_spacing = max(float(source_text_block.font_size or style.font_size or 12.0) * 1.25, 14.0)

            safe_target_rect = self.ensure_text_rect(
                target_rect,
                source_text_block.page.rect,
                max(float(style.font_size or 12.0), 8.0),
            )
            source_y0 = float(source_text_block.bbox[1])
            base_font_size = max(float(style.font_size or source_text_block.font_size or 12.0), 8.0)
            line_height = max((average_spacing / max(base_font_size, 0.1)) * base_font_size, base_font_size * 1.18)
            first_baseline = (
                max(float(source_lines[0].baseline_y - source_y0), base_font_size)
                if source_lines
                else min(base_font_size, safe_target_rect.height - 1.0)
            )
            hard_preview_lines: list[TextPreviewLineModel] = []

            for index, requested_line in enumerate(requested_lines):
                if not requested_line.strip():
                    continue

                source_line = source_lines[min(index, len(source_lines) - 1)] if source_lines else None
                source_preview_line = source_preview_lines[index] if index < len(source_preview_lines) else None
                source_line_text = "".join(span.text for span in source_line.spans).strip() if source_line else ""
                if source_preview_line is not None and normalize_text(requested_line) == normalize_text(source_line_text):
                    hard_preview_lines.append(source_preview_line)
                    continue

                first_span = next((span for span in source_line.spans if span.text.strip()), None) if source_line else None
                line_font_size = max(float(first_span.font_size if first_span else style.font_size), 6.0)
                preview_spans = self.build_single_line_preview_spans(
                    source_line,
                    source_text_block.bbox,
                    requested_line,
                    line_font_size,
                    style,
                    source_text_block.page,
                )
                preview_font_size = max(float(preview_spans[0].fontSize if preview_spans else line_font_size), 6.0)
                preview_font_name = str(preview_spans[0].fontName if preview_spans else style.font_name)
                preview_color_hex = str(preview_spans[0].colorHex if preview_spans else style.color_hex)
                preview_is_bold = bool(preview_spans[0].isBold if preview_spans else style.is_bold)
                preview_is_italic = bool(preview_spans[0].isItalic if preview_spans else style.is_italic)
                if source_line is not None and index < len(source_lines):
                    preview_x = max(float((first_span.origin_x if first_span else source_line.bbox[0]) - source_text_block.bbox[0]), 0.0)
                    preview_y = max(float(source_line.bbox[1] - source_y0), 0.0)
                    preview_baseline_y = max(float(source_line.baseline_y - source_y0), preview_font_size)
                else:
                    preview_x = 0.0
                    preview_baseline_y = first_baseline + (index * line_height)
                    preview_y = max(preview_baseline_y - preview_font_size, 0.0)

                hard_preview_lines.append(
                    TextPreviewLineModel(
                        text=requested_line,
                        x=preview_x,
                        y=preview_y,
                        baselineY=preview_baseline_y,
                        fontSize=preview_font_size,
                        fontName=preview_font_name,
                        colorHex=preview_color_hex,
                        isBold=preview_is_bold,
                        isItalic=preview_is_italic,
                        spans=preview_spans,
                    )
                )

            if hard_preview_lines:
                max_line_width = max(
                    (line.x or 0.0) + sum(max(span.width or 0.0, 0.0) for span in line.spans)
                    for line in hard_preview_lines
                )
                required_height = max(
                    max((line.baselineY or 0.0) + max(float(line.fontSize or base_font_size) * 0.35, 1.0) for line in hard_preview_lines),
                    safe_target_rect.height,
                )
                effective_preview_rect = fitz.Rect(
                    safe_target_rect.x0,
                    safe_target_rect.y0,
                    min(max(safe_target_rect.x0 + safe_target_rect.width, safe_target_rect.x0 + max_line_width + 1.0), source_text_block.page.rect.x1),
                    min(safe_target_rect.y0 + required_height, source_text_block.page.rect.y1),
                )
                preview_layout_lines = [preview_line.text for preview_line in hard_preview_lines]
                preview_font_size = max(float(hard_preview_lines[0].fontSize or style.font_size), 6.0)
                preview_line_height_ratio = max(line_height / max(preview_font_size, 0.1), 1.05)
                return preview_layout_lines, preview_font_size, preview_line_height_ratio, hard_preview_lines, effective_preview_rect

        if (
            len(source_lines) > 1
            and len(requested_lines) == len(source_lines)
            and abs(target_rect.width - source_rect.width) < 0.5
            and abs(target_rect.height - source_rect.height) < 0.5
        ):
            source_y0 = float(source_text_block.bbox[1])
            preserved_preview_lines: list[TextPreviewLineModel] = []

            for index, source_line in enumerate(source_lines):
                requested_line = requested_lines[index]
                source_preview_line = source_preview_lines[index] if index < len(source_preview_lines) else None
                source_line_text = "".join(span.text for span in source_line.spans).strip()
                first_span = next((span for span in source_line.spans if span.text.strip()), None)
                if not requested_line.strip():
                    continue

                if source_preview_line is not None and normalize_text(requested_line) == normalize_text(source_line_text):
                    preserved_preview_lines.append(source_preview_line)
                    continue

                preview_spans = self.build_single_line_preview_spans(
                    source_line,
                    source_text_block.bbox,
                    requested_line,
                    max(float(first_span.font_size if first_span else style.font_size), 6.0),
                    style,
                    source_text_block.page,
                )
                preview_font_size = max(float(preview_spans[0].fontSize if preview_spans else style.font_size), 6.0)
                preview_font_name = str(preview_spans[0].fontName if preview_spans else style.font_name)
                preview_color_hex = str(preview_spans[0].colorHex if preview_spans else style.color_hex)
                preview_is_bold = bool(preview_spans[0].isBold if preview_spans else style.is_bold)
                preview_is_italic = bool(preview_spans[0].isItalic if preview_spans else style.is_italic)
                preview_x = max(float((first_span.origin_x if first_span else source_line.bbox[0]) - source_text_block.bbox[0]), 0.0)
                preview_y = max(float(source_line.bbox[1] - source_y0), 0.0)
                preview_baseline_y = max(float(source_line.baseline_y - source_y0), preview_font_size)
                preserved_preview_lines.append(
                    TextPreviewLineModel(
                        text=requested_line,
                        x=preview_x,
                        y=preview_y,
                        baselineY=preview_baseline_y,
                        fontSize=preview_font_size,
                        fontName=preview_font_name,
                        colorHex=preview_color_hex,
                        isBold=preview_is_bold,
                        isItalic=preview_is_italic,
                        spans=preview_spans,
                    )
                )

            if preserved_preview_lines:
                preview_layout_lines = [preview_line.text for preview_line in preserved_preview_lines]
                preview_font_size = max(float(preserved_preview_lines[0].fontSize or style.font_size), 6.0)
                preview_line_height_ratio = derive_line_height_ratio(
                    source_text_block.spans,
                    max(float(source_text_block.font_size or preview_font_size), 1.0),
                )
                return preview_layout_lines, preview_font_size, preview_line_height_ratio, preserved_preview_lines, source_rect

        safe_target_rect = self.ensure_text_rect(
            target_rect,
            source_text_block.page.rect,
            max(float(style.font_size or 12.0), 8.0),
        )
        if len(source_lines) > 1:
            source_line_heights = [max(line.bbox[3] - line.bbox[1], source_text_block.font_size * 1.1) for line in source_lines]
            source_line_spacing = [
                max(source_lines[index + 1].baseline_y - source_lines[index].baseline_y, source_line_heights[index])
                for index in range(len(source_lines) - 1)
            ]
            average_spacing = sum(source_line_spacing) / len(source_line_spacing) if source_line_spacing else max(float(source_text_block.font_size or 12.0) * 1.25, 14.0)
        else:
            average_spacing = max(float(source_text_block.font_size or 12.0) * 1.25, 14.0)

        base_font_size = max(float(style.font_size or source_text_block.font_size or 12.0), 8.0)
        safe_width = max(safe_target_rect.width - 2.0, 12.0)

        chosen_font_size = base_font_size
        wrapped_lines = self.wrap_text_to_lines(
            normalized_text,
            style.font_name,
            chosen_font_size,
            safe_width,
            source_text_block.page,
            style.is_bold,
            style.is_italic,
        )

        line_height = max((average_spacing / max(base_font_size, 0.1)) * chosen_font_size, chosen_font_size * 1.18)
        first_baseline = min(chosen_font_size, safe_target_rect.height - 1.0)
        required_height = max(first_baseline + max(len(wrapped_lines) - 1, 0) * line_height + (chosen_font_size * 0.35), safe_target_rect.height)
        effective_preview_rect = fitz.Rect(
            safe_target_rect.x0,
            safe_target_rect.y0,
            safe_target_rect.x1,
            min(safe_target_rect.y0 + required_height, source_text_block.page.rect.y1),
        )
        preview_lines = [
            TextPreviewLineModel(
                text=line_text,
                x=0.0,
                y=max((first_baseline + (index * line_height)) - chosen_font_size, 0.0),
                baselineY=first_baseline + (index * line_height),
                fontSize=chosen_font_size,
                fontName=style.font_name,
                colorHex=style.color_hex,
                isBold=style.is_bold,
                isItalic=style.is_italic,
                spans=[
                    TextPreviewSpanModel(
                        text=line_text,
                        x=0.0,
                        width=max(self.measure_preview_text_width(
                            line_text,
                            style.font_name,
                            chosen_font_size,
                            style.is_bold,
                            style.is_italic,
                        ), 0.0),
                        fontSize=chosen_font_size,
                        fontName=style.font_name,
                        colorHex=style.color_hex,
                        isBold=style.is_bold,
                        isItalic=style.is_italic,
                    )
                ],
            )
            for index, line_text in enumerate(wrapped_lines)
            if line_text
        ]
        return wrapped_lines, chosen_font_size, max(line_height / max(chosen_font_size, 0.1), 1.05), preview_lines, effective_preview_rect

    def build_preview_text_block_model(
        self,
        source_text_block: InternalTextBlock,
        text: str,
        x: float,
        y: float,
        width: float,
        height: float,
        font_name: str | None = None,
        font_size: float | None = None,
        color_hex: str | None = None,
        is_bold: bool | None = None,
        is_italic: bool | None = None,
    ) -> DetectedTextBlockModel:
        normalized_text = normalize_editable_text_characters(text or "")
        normalized_text_with_lines = normalized_text.replace("\r\n", "\n").replace("\r", "\n")
        requested_lines = normalized_text_with_lines.split("\n")
        has_explicit_line_breaks = "\n" in normalized_text_with_lines
        source_rect = fitz.Rect(source_text_block.bbox)
        page_rect = source_text_block.page.rect
        resolved_style = self.resolve_text_style(
            source_text_block,
            font_name,
            font_size,
            color_hex,
            is_bold,
            is_italic,
        )
        preview_font_resource = self.resolve_font_resource(
            source_text_block.page,
            resolved_style.font_name,
            resolved_style.is_bold,
            resolved_style.is_italic,
            text_sample=normalized_text or source_text_block.text,
            source_font_resource_name=source_text_block.font_resource_name,
            source_font_postscript_name=source_text_block.font_postscript_name,
            source_font_family=source_text_block.font_family,
        )
        logger.debug(
            "Text preview font trace: block=%s page=%s source_font=%s source_resource=%s requested_font=%s "
            "resolved_font=%s source=%s status=%s tounicode=%s source_size=%.3f preview_size=%.3f color=%s bbox=%s glyphs=%s",
            source_text_block.text_block_id,
            source_text_block.page_number,
            source_text_block.font_name,
            source_text_block.font_resource_name,
            resolved_style.font_name,
            preview_font_resource.resolved_font_name,
            preview_font_resource.font_source,
            preview_font_resource.font_resolution_status,
            preview_font_resource.to_unicode_available or source_text_block.to_unicode_available,
            float(source_text_block.font_size or 0.0),
            float(resolved_style.font_size or 0.0),
            resolved_style.color_hex,
            tuple(round(float(value), 3) for value in source_text_block.bbox),
            len(source_text_block.glyph_run or []),
        )
        preview_font_resolution_status = preview_font_resource.font_resolution_status or source_text_block.font_resolution_status
        preview_edit_capability = (
            "exact-editable"
            if not preview_font_resource.is_fallback and not preview_font_resource.missing_glyphs and preview_font_resource.can_embed_for_editing
            else "limited-editable"
        )
        preview_save_capability = (
            "exact-save"
            if not preview_font_resource.is_fallback and not preview_font_resource.missing_glyphs and preview_font_resource.can_embed_for_editing
            else "blocked"
        )
        target_rect = fitz.Rect(
            float(x) * page_rect.width,
            float(y) * page_rect.height,
            float(x + width) * page_rect.width,
            float(y + height) * page_rect.height,
        )

        source_text_value = normalize_text(source_text_block.text)
        requested_text_value = normalize_text(normalized_text)
        style_matches_source = self.style_matches_source_text_block(source_text_block, resolved_style)
        source_text_lines = self.build_text_lines(source_text_block)
        source_line_values = [normalize_text("".join(span.text for span in source_line.spans)) for source_line in source_text_lines]
        requested_line_values = [normalize_text(line) for line in requested_lines]
        line_structure_matches_source = (
            not has_explicit_line_breaks
            or requested_line_values == source_line_values
        )

        if requested_text_value == source_text_value and style_matches_source and line_structure_matches_source:
            source_lines = source_text_lines
            preview_lines = build_preview_lines_from_text_lines(
                source_lines,
                source_text_block.bbox,
                source_text_block.font_name,
                source_text_block.color,
                source_text_block.font_size,
            )
            line_height_ratio = derive_line_height_ratio(source_text_block.spans, max(source_text_block.font_size, 1.0))
            is_bold, is_italic = derive_font_traits(source_text_block.font_name)
            return DetectedTextBlockModel(
                textBlockId=build_text_block_id(source_text_block.page_number, source_text_block.bbox, normalized_text, source_text_block.font_size, source_text_block.font_name, font_resource_name=source_text_block.font_resource_name),
                pageNumber=source_text_block.page_number,
                text=normalized_text,
                x=x,
                y=y,
                width=width,
                height=height,
                fontSize=source_text_block.font_size,
                fontName=source_text_block.font_name,
                colorHex=rgb_tuple_to_hex(source_text_block.color),
                isBold=is_bold,
                isItalic=is_italic,
                renderedFontSize=source_text_block.font_size,
                lineHeightRatio=line_height_ratio,
                previewMode="source",
                previewCoordinateSpace="exact-local",
                previewViewportWidth=max(source_rect.width, 0.0),
                previewViewportHeight=max(source_rect.height, 0.0),
                layoutContainerId=source_text_block.layout_container_id,
                editableRunId=source_text_block.editable_run_id or source_text_block.text_block_id,
                documentEditMode=source_text_block.document_edit_mode,
                pageEditMode=source_text_block.page_edit_mode,
                fontResourceName=source_text_block.font_resource_name,
                fontPostScriptName=source_text_block.font_postscript_name,
                fontFamily=source_text_block.font_family,
                fontSource=source_text_block.font_source,
                fontResolutionStatus=source_text_block.font_resolution_status,
                editCapability=source_text_block.edit_capability,
                saveCapability=source_text_block.save_capability,
                toUnicodeAvailable=source_text_block.to_unicode_available,
                canEmbedForEditing=source_text_block.can_embed_for_editing,
                missingGlyphs=list(source_text_block.missing_glyphs or []),
                glyphRun=list(source_text_block.glyph_run or []),
                layoutLines=build_layout_lines_from_spans(source_text_block.spans) or [normalized_text],
                previewLines=preview_lines,
            )

        if self.is_single_line_text_block(source_text_block) and not has_explicit_line_breaks:
            layout_lines, rendered_font_size, line_height_ratio, preview_lines, effective_preview_rect = self.preview_single_line_layout(
                source_text_block,
                source_rect,
                target_rect,
                normalized_text,
                resolved_style,
            )
        else:
            layout_lines, rendered_font_size, line_height_ratio, preview_lines, effective_preview_rect = self.preview_multiline_layout(
                source_text_block,
                target_rect,
                normalized_text,
                resolved_style,
            )

        effective_preview_rect = fitz.Rect(effective_preview_rect)
        normalized_x = clamp_unit(effective_preview_rect.x0 / max(page_rect.width, 1.0))
        normalized_y = clamp_unit(effective_preview_rect.y0 / max(page_rect.height, 1.0))
        normalized_width = clamp_unit(effective_preview_rect.width / max(page_rect.width, 1.0))
        normalized_height = clamp_unit(effective_preview_rect.height / max(page_rect.height, 1.0))

        return DetectedTextBlockModel(
            textBlockId=build_text_block_id(source_text_block.page_number, source_text_block.bbox, normalized_text, rendered_font_size, resolved_style.font_name, font_resource_name=source_text_block.font_resource_name),
            pageNumber=source_text_block.page_number,
            text=normalized_text,
            x=normalized_x,
            y=normalized_y,
            width=normalized_width,
            height=normalized_height,
            fontSize=resolved_style.font_size,
            fontName=resolved_style.font_name,
            colorHex=resolved_style.color_hex,
            isBold=resolved_style.is_bold,
            isItalic=resolved_style.is_italic,
            renderedFontSize=rendered_font_size,
            lineHeightRatio=line_height_ratio,
            previewMode="preview",
            previewCoordinateSpace="exact-local",
            previewViewportWidth=max(effective_preview_rect.width, 0.0),
            previewViewportHeight=max(effective_preview_rect.height, 0.0),
            layoutContainerId=source_text_block.layout_container_id,
            editableRunId=source_text_block.editable_run_id or source_text_block.text_block_id,
            documentEditMode=source_text_block.document_edit_mode,
            pageEditMode=source_text_block.page_edit_mode,
            fontResourceName=preview_font_resource.font_resource_name or source_text_block.font_resource_name,
            fontPostScriptName=preview_font_resource.font_postscript_name or source_text_block.font_postscript_name,
            fontFamily=preview_font_resource.font_family or source_text_block.font_family,
            fontSource=preview_font_resource.font_source,
            fontResolutionStatus=preview_font_resolution_status,
            editCapability=preview_edit_capability,
            saveCapability=preview_save_capability,
            toUnicodeAvailable=preview_font_resource.to_unicode_available or source_text_block.to_unicode_available,
            canEmbedForEditing=preview_font_resource.can_embed_for_editing and source_text_block.can_embed_for_editing,
            missingGlyphs=list(preview_font_resource.missing_glyphs),
            glyphRun=list(source_text_block.glyph_run or []),
            layoutLines=layout_lines or [normalized_text],
            previewLines=preview_lines,
        )

    def insert_multiline_text_layout(
        self,
        page: fitz.Page,
        source_text_block: InternalTextBlock,
        source_rect: fitz.Rect,
        target_rect: fitz.Rect,
        text: str,
        style: ResolvedTextStyle | None = None,
    ) -> None:
        normalized_text = normalize_editable_text_characters(text or "")
        if not normalized_text.strip():
            return

        source_lines = self.build_text_lines(source_text_block)
        resolved_style = style or self.resolve_text_style(source_text_block)
        safe_target_rect = self.ensure_text_rect(
            target_rect,
            page.rect,
            max(float(resolved_style.font_size or 12.0), 8.0),
        )

        if len(source_lines) > 1:
            source_line_heights = [max(line.bbox[3] - line.bbox[1], source_text_block.font_size * 1.1) for line in source_lines]
            source_line_spacing = [
                max(source_lines[index + 1].baseline_y - source_lines[index].baseline_y, source_line_heights[index])
                for index in range(len(source_lines) - 1)
            ]
            average_spacing = sum(source_line_spacing) / len(source_line_spacing) if source_line_spacing else max(float(source_text_block.font_size or 12.0) * 1.25, 14.0)
        else:
            average_spacing = max(float(source_text_block.font_size or 12.0) * 1.25, 14.0)

        base_font_size = max(float(resolved_style.font_size or source_text_block.font_size or 12.0), 8.0)
        safe_width = max(safe_target_rect.width - 2.0, 12.0)

        chosen_font_size = base_font_size
        wrapped_lines = self.wrap_text_to_lines(
            normalized_text,
            resolved_style.font_name,
            chosen_font_size,
            safe_width,
            page,
            resolved_style.is_bold,
            resolved_style.is_italic,
        )

        line_height = max((average_spacing / max(base_font_size, 0.1)) * chosen_font_size, chosen_font_size * 1.18)
        first_baseline = min(
            max(safe_target_rect.y0 + chosen_font_size, safe_target_rect.y0 + chosen_font_size * 0.95),
            safe_target_rect.y1 - 1.0,
        )

        for index, line_text in enumerate(wrapped_lines):
            if not line_text:
                continue

            baseline_y = first_baseline + (index * line_height)
            if baseline_y > safe_target_rect.y1:
                break

            self.insert_text_with_resolved_font(
                page,
                fitz.Point(safe_target_rect.x0, baseline_y),
                line_text,
                resolved_style.font_name,
                chosen_font_size,
                resolved_style.color,
                resolved_style.is_bold,
                resolved_style.is_italic,
                source_text_block.font_resource_name,
                source_text_block.font_postscript_name,
                source_text_block.font_family,
            )

    def insert_single_line_text(
        self,
        page: fitz.Page,
        source_text_block: InternalTextBlock,
        source_rect: fitz.Rect,
        target_rect: fitz.Rect,
        text: str,
        style: ResolvedTextStyle | None = None,
    ) -> None:
        normalized_text = normalize_editable_text_characters(text or "")
        if not normalized_text.strip():
            return

        primary_span = next((span for span in source_text_block.spans if span.text.strip()), None)
        resolved_style = style or self.resolve_text_style(source_text_block)
        safe_target_rect = self.ensure_text_rect(
            target_rect,
            page.rect,
            max(float(resolved_style.font_size or 12.0), 8.0),
        )

        if primary_span is not None:
            font_name = resolved_style.font_name or primary_span.font_name or source_text_block.font_name
            font_size = max(float(resolved_style.font_size or primary_span.font_size), 8.0)
            color = resolved_style.color or primary_span.color or source_text_block.color
            origin_offset_y = primary_span.origin_y - source_rect.y0
        else:
            font_name = resolved_style.font_name or source_text_block.font_name
            font_size = max(float(resolved_style.font_size or source_text_block.font_size or 12.0), 8.0)
            color = resolved_style.color or source_text_block.color
            origin_offset_y = font_size

        fitted_font_size = font_size

        baseline_y = safe_target_rect.y0 + max(origin_offset_y * (safe_target_rect.height / max(source_rect.height, 1.0)), fitted_font_size)
        baseline_y = min(max(baseline_y, safe_target_rect.y0 + fitted_font_size), safe_target_rect.y1 - 1.0)

        self.insert_text_with_resolved_font(
            page,
            fitz.Point(safe_target_rect.x0, baseline_y),
            normalized_text,
            font_name,
            fitted_font_size,
            color,
            resolved_style.is_bold,
            resolved_style.is_italic,
            source_text_block.font_resource_name,
            source_text_block.font_postscript_name,
            source_text_block.font_family,
        )

    def find_text_block(self, document: fitz.Document, text_block_id: str) -> InternalTextBlock:
        for text_block in self.iterate_text_blocks(document):
            if text_block.text_block_id == text_block_id:
                return text_block
        raise ValueError("The selected PDF text could not be found anymore. Reload the document text and try again.")

    def find_result_text_block(
        self,
        output_path: str,
        page_number: int,
        expected_text: str,
        expected_rect: fitz.Rect,
        excluded_text_block_ids: set[str] | None = None,
    ) -> DetectedTextBlockModel | None:
        normalized_expected_text = normalize_text(expected_text)
        if not normalized_expected_text:
            return None

        excluded_ids = excluded_text_block_ids or set()
        result_document = fitz.open(output_path)
        try:
            candidates = [
                text_block
                for text_block in self.iterate_text_blocks(result_document)
                if text_block.page_number == page_number and text_block.text_block_id not in excluded_ids
            ]

            if not candidates:
                return None

            exact_text_matches = [
                text_block
                for text_block in candidates
                if normalize_text(text_block.text) == normalized_expected_text
            ]
            if exact_text_matches:
                candidates = exact_text_matches
            else:
                close_text_matches = [
                    text_block
                    for text_block in candidates
                    if normalized_expected_text in normalize_text(text_block.text)
                    or normalize_text(text_block.text) in normalized_expected_text
                ]
                if close_text_matches:
                    candidates = close_text_matches
                else:
                    return None

            expected_center_x = (expected_rect.x0 + expected_rect.x1) / 2.0
            expected_center_y = (expected_rect.y0 + expected_rect.y1) / 2.0

            def sort_key(text_block: InternalTextBlock) -> tuple[float, int, float, float]:
                candidate_rect = fitz.Rect(text_block.bbox)
                candidate_center_x = (candidate_rect.x0 + candidate_rect.x1) / 2.0
                candidate_center_y = (candidate_rect.y0 + candidate_rect.y1) / 2.0
                distance = ((candidate_center_x - expected_center_x) ** 2 + (candidate_center_y - expected_center_y) ** 2) ** 0.5
                text_length_delta = abs(len(normalize_text(text_block.text)) - len(normalized_expected_text))
                width_delta = abs(candidate_rect.width - expected_rect.width)
                height_delta = abs(candidate_rect.height - expected_rect.height)
                return (distance, text_length_delta, width_delta, height_delta)

            return min(candidates, key=sort_key).to_model()
        finally:
            result_document.close()

    def save_document(self, document: fitz.Document, output_path: str) -> None:
        output_directory = os.path.dirname(output_path)
        if output_directory:
            os.makedirs(output_directory, exist_ok=True)
        document.save(output_path, garbage=4, deflate=True)

    def preview_text_layout(self, request: PreviewTextLayoutRequest) -> PreviewTextLayoutResponse:
        input_path = ensure_existing_file(request.sourcePath)
        document = fitz.open(input_path)
        try:
            source_text_block = self.find_text_block(document, request.textBlockId)
            result_text_block = self.build_preview_text_block_model(
                source_text_block,
                request.text,
                request.x,
                request.y,
                request.width,
                request.height,
                request.fontName,
                request.fontSize,
                request.colorHex,
                request.isBold,
                request.isItalic,
            )
            return PreviewTextLayoutResponse(
                sourceTextBlockId=source_text_block.text_block_id,
                text=request.text,
                pageNumber=source_text_block.page_number,
                resultTextBlock=result_text_block,
            )
        finally:
            document.close()

    def resolve_font_resource_request(self, request: ResolveFontResourceRequest) -> ResolveFontResourceResponse:
        input_path = ensure_existing_file(request.sourcePath)
        document = fitz.open(input_path)
        try:
            source_text_block = self.find_text_block(document, request.textBlockId)
            requested_font_name = (request.fontName or "").strip() or source_text_block.font_name
            font_resource = self.resolve_font_resource(
                source_text_block.page,
                requested_font_name,
                request.isBold,
                request.isItalic,
                text_sample=source_text_block.text,
                source_font_resource_name=source_text_block.font_resource_name,
                source_font_postscript_name=source_text_block.font_postscript_name,
                source_font_family=source_text_block.font_family,
            )
            return ResolveFontResourceResponse(
                requestedFontName=requested_font_name,
                resolvedFontName=font_resource.resolved_font_name,
                fontFamily=font_resource.font_family or font_resource.browser_family_name,
                fontSource=font_resource.font_source,
                fontFormat=font_resource.font_format,
                contentType=font_resource.content_type,
                fontDataBase64=base64.b64encode(font_resource.font_data).decode("ascii"),
                sourceFontResourceName=font_resource.font_resource_name or source_text_block.font_resource_name,
                sourceFontPostScriptName=font_resource.font_postscript_name or source_text_block.font_postscript_name,
                sourceFontFamily=font_resource.font_family or source_text_block.font_family,
                fontResolutionStatus=font_resource.font_resolution_status or source_text_block.font_resolution_status,
                toUnicodeAvailable=font_resource.to_unicode_available or source_text_block.to_unicode_available,
                canEmbedForEditing=font_resource.can_embed_for_editing and source_text_block.can_embed_for_editing,
                editCapability=source_text_block.edit_capability if source_text_block.edit_capability != "exact-editable" else ("exact-editable" if not font_resource.missing_glyphs and font_resource.can_embed_for_editing else "limited-editable"),
                saveCapability="exact-save" if not font_resource.is_fallback and not font_resource.missing_glyphs and font_resource.can_embed_for_editing else "blocked",
                missingGlyphs=list(font_resource.missing_glyphs),
                isFallback=font_resource.is_fallback,
                warning=font_resource.warning,
            )
        finally:
            document.close()

    def ensure_operation_font_can_save_exactly(
        self,
        source_text_block: InternalTextBlock,
        font_name: str,
        is_bold: bool,
        is_italic: bool,
        text_sample: str,
        source_font_resource_name: str | None = None,
        source_font_postscript_name: str | None = None,
        source_font_family: str | None = None,
    ) -> ResolvedFontResource:
        font_resource = self.resolve_font_resource(
            source_text_block.page,
            font_name,
            is_bold,
            is_italic,
            text_sample=text_sample,
            source_font_resource_name=source_font_resource_name or source_text_block.font_resource_name,
            source_font_postscript_name=source_font_postscript_name or source_text_block.font_postscript_name,
            source_font_family=source_font_family or source_text_block.font_family,
        )
        if font_resource.is_fallback or font_resource.missing_glyphs or not font_resource.can_embed_for_editing:
            raise ValueError(
                "This PDF text cannot be saved exactly because the original font cannot represent the edited characters safely. "
                "Choose a compatible installed font explicitly before saving."
            )

        return font_resource

    def apply_text_overlays(self, request: TextOverlayCommitRequest) -> TextOverlayCommitResponse:
        input_path = ensure_existing_file(request.sourcePath)
        document = fitz.open(input_path)
        try:
            source_blocks_by_id = {
                text_block.text_block_id: text_block
                for text_block in self.iterate_text_blocks(document)
            }

            touched_pages: set[int] = set()
            redacted_source_ids: set[str] = set()

            for operation in request.operations:
                source_text_block = source_blocks_by_id.get(operation.sourceTextBlockId)
                if source_text_block is None:
                    raise ValueError("A selected PDF text object could not be committed because its source text no longer exists in the base document.")

                if operation.hideSourceOnCommit and operation.sourceTextBlockId not in redacted_source_ids:
                    source_rect = fitz.Rect(source_text_block.bbox)
                    padding_x = min(max((float(source_text_block.font_size) or 12.0) * 0.05, 0.4), 1.0)
                    padding_y = min(max((float(source_text_block.font_size) or 12.0) * 0.04, 0.35), 0.8)
                    redact_rect = fitz.Rect(
                        source_rect.x0 - padding_x,
                        source_rect.y0 - padding_y,
                        source_rect.x1 + padding_x,
                        source_rect.y1 + padding_y,
                    )
                    source_text_block.page.add_redact_annot(redact_rect, fill=(1, 1, 1))
                    touched_pages.add(source_text_block.page_number)
                    redacted_source_ids.add(operation.sourceTextBlockId)

            for page_number in touched_pages:
                document[page_number - 1].apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

            for operation in request.operations:
                source_text_block = source_blocks_by_id.get(operation.sourceTextBlockId)
                if source_text_block is None:
                    continue

                target_page = source_text_block.page
                page_rect = target_page.rect
                target_rect = fitz.Rect(
                    max(min(float(operation.x), 1.0), 0.0) * page_rect.width,
                    max(min(float(operation.y), 1.0), 0.0) * page_rect.height,
                    max(min(float(operation.x) + float(operation.width), 1.0), 0.0) * page_rect.width,
                    max(min(float(operation.y) + float(operation.height), 1.0), 0.0) * page_rect.height,
                )

                if target_rect.width < 8 or target_rect.height < 8:
                    raise ValueError("The selected text area is too small to place text there.")

                source_rect = fitz.Rect(source_text_block.bbox)
                replacement_text = operation.text if operation.text is not None else source_text_block.text
                replacement_text_with_lines = normalize_editable_text_characters(replacement_text or "").replace("\r\n", "\n").replace("\r", "\n")
                has_explicit_line_breaks = "\n" in replacement_text_with_lines

                if not normalize_text(replacement_text):
                    continue

                resolved_style = self.resolve_text_style(
                    source_text_block,
                    operation.fontName,
                    operation.fontSize,
                    operation.colorHex,
                    operation.isBold,
                    operation.isItalic,
                )
                logger.debug(
                    "Text overlay commit trace: block=%s page=%s mode=%s source_font=%s source_resource=%s "
                    "operation_font=%s font_resource=%s status=%s save=%s source_size=%.3f operation_size=%.3f "
                    "source_bbox=%s target_bbox=%s glyphs=%s",
                    operation.sourceTextBlockId,
                    source_text_block.page_number,
                    operation.previewCoordinateSpace,
                    source_text_block.font_name,
                    source_text_block.font_resource_name,
                    resolved_style.font_name,
                    operation.fontResourceName or source_text_block.font_resource_name,
                    operation.fontResolutionStatus or source_text_block.font_resolution_status,
                    operation.saveCapability or source_text_block.save_capability,
                    float(source_text_block.font_size or 0.0),
                    float(resolved_style.font_size or 0.0),
                    tuple(round(float(value), 3) for value in source_text_block.bbox),
                    tuple(round(float(value), 3) for value in (target_rect.x0, target_rect.y0, target_rect.x1, target_rect.y1)),
                    len(source_text_block.glyph_run or []),
                )

                if (
                    normalize_text(replacement_text) == normalize_text(source_text_block.text)
                    and self.style_matches_source_text_block(source_text_block, resolved_style)
                    and not has_explicit_line_breaks
                ):
                    self.clone_text_block_layout(
                        target_page,
                        source_text_block,
                        source_rect,
                        target_rect,
                    )
                elif operation.previewLines:
                    self.ensure_operation_font_can_save_exactly(
                        source_text_block,
                        resolved_style.font_name,
                        resolved_style.is_bold,
                        resolved_style.is_italic,
                        replacement_text,
                        source_font_resource_name=operation.fontResourceName,
                        source_font_postscript_name=operation.fontPostScriptName,
                        source_font_family=operation.fontFamily,
                    )
                    self.insert_preview_lines_layout(
                        target_page,
                        target_rect,
                        operation.previewCoordinateSpace,
                        operation.previewViewportWidth,
                        operation.previewViewportHeight,
                        operation.previewLines,
                        resolved_style.color,
                        operation.fontResourceName,
                        operation.fontPostScriptName,
                        operation.fontFamily,
                    )
                elif self.is_single_line_text_block(source_text_block) and not has_explicit_line_breaks:
                    self.ensure_operation_font_can_save_exactly(
                        source_text_block,
                        resolved_style.font_name,
                        resolved_style.is_bold,
                        resolved_style.is_italic,
                        replacement_text,
                        source_font_resource_name=operation.fontResourceName,
                        source_font_postscript_name=operation.fontPostScriptName,
                        source_font_family=operation.fontFamily,
                    )
                    self.insert_single_line_text(
                        target_page,
                        source_text_block,
                        source_rect,
                        target_rect,
                        replacement_text,
                        resolved_style,
                    )
                else:
                    self.ensure_operation_font_can_save_exactly(
                        source_text_block,
                        resolved_style.font_name,
                        resolved_style.is_bold,
                        resolved_style.is_italic,
                        replacement_text,
                        source_font_resource_name=operation.fontResourceName,
                        source_font_postscript_name=operation.fontPostScriptName,
                        source_font_family=operation.fontFamily,
                    )
                    self.insert_multiline_text_layout(
                        target_page,
                        source_text_block,
                        source_rect,
                        target_rect,
                        replacement_text,
                        resolved_style,
                    )

            self.save_document(document, request.outputPath)

            return TextOverlayCommitResponse(
                committedOverlayCount=len(request.operations),
            )
        finally:
            document.close()

    def insert_preview_lines_layout(
        self,
        page: fitz.Page,
        target_rect: fitz.Rect,
        preview_coordinate_space: str | None,
        preview_viewport_width: float | None,
        preview_viewport_height: float | None,
        preview_lines: list[TextPreviewLineModel],
        fallback_color: tuple[float, float, float],
        source_font_resource_name: str | None = None,
        source_font_postscript_name: str | None = None,
        source_font_family: str | None = None,
    ) -> None:
        if not preview_lines:
            return

        normalized_preview_coordinate_space = str(preview_coordinate_space or "").strip().lower()
        if (
            normalized_preview_coordinate_space == "exact-local"
            and float(preview_viewport_width or 0.0) > 0.0
            and float(preview_viewport_height or 0.0) > 0.0
        ):
            for line in preview_lines:
                spans = line.spans or [
                    TextPreviewSpanModel(
                        text=line.text,
                        x=line.x,
                        width=self.measure_preview_text_width(
                            line.text,
                            line.fontName,
                            float(line.fontSize or 8.0),
                            bool(line.isBold),
                            bool(line.isItalic),
                            page,
                        ),
                        fontSize=line.fontSize,
                        fontName=line.fontName,
                        colorHex=line.colorHex,
                        isBold=line.isBold,
                        isItalic=line.isItalic,
                    )
                ]
                baseline_y = float(line.baselineY or 0.0)
                if baseline_y <= 0.0:
                    baseline_y = max(float(line.y or 0.0) + float(line.fontSize or 8.0), float(line.fontSize or 8.0))

                for span in spans:
                    if not span.text:
                        continue

                    self.insert_text_with_resolved_font(
                        page,
                        fitz.Point(
                            target_rect.x0 + max(float(span.x or line.x or 0.0), 0.0),
                            target_rect.y0 + baseline_y,
                        ),
                        span.text,
                        span.fontName or line.fontName,
                        max(float(span.fontSize or line.fontSize or 8.0), 6.0),
                        color_hex_to_rgb_tuple(span.colorHex or line.colorHex, fallback_color),
                        span.isBold,
                        span.isItalic,
                        source_font_resource_name,
                        source_font_postscript_name,
                        source_font_family,
                    )
            return

        safe_target_rect = self.ensure_text_rect(target_rect, page.rect, 8.0)
        preview_width = max(
            (
                max(
                    [
                        float(span.x or line.x or 0.0) + self.measure_preview_text_width(
                            span.text,
                            span.fontName or line.fontName,
                            float(span.fontSize or line.fontSize or 8.0),
                            bool(span.isBold),
                            bool(span.isItalic),
                            page,
                        )
                        for span in (line.spans or [TextPreviewSpanModel(
                            text=line.text,
                            x=line.x,
                            width=self.measure_preview_text_width(
                                line.text,
                                line.fontName,
                                float(line.fontSize or 8.0),
                                bool(line.isBold),
                                bool(line.isItalic),
                                page,
                            ),
                            fontSize=line.fontSize,
                            fontName=line.fontName,
                            colorHex=line.colorHex,
                            isBold=line.isBold,
                            isItalic=line.isItalic,
                        )])
                    ]
                    or [0.0]
                )
                for line in preview_lines
            ),
            default=safe_target_rect.width,
        )
        preview_height = max(
            (
                float(line.y or 0.0) + max(float(line.fontSize or 8.0) * 1.25, 8.0)
                for line in preview_lines
            ),
            default=safe_target_rect.height,
        )

        scale_x = safe_target_rect.width / max(preview_width, 1.0)
        scale_y = safe_target_rect.height / max(preview_height, 1.0)
        scale_font = min(scale_x, scale_y)

        for line in preview_lines:
            spans = line.spans or [
                TextPreviewSpanModel(
                    text=line.text,
                    x=line.x,
                    width=self.measure_preview_text_width(
                        line.text,
                        line.fontName,
                        float(line.fontSize or 8.0),
                        bool(line.isBold),
                        bool(line.isItalic),
                        page,
                    ),
                    fontSize=line.fontSize,
                    fontName=line.fontName,
                    colorHex=line.colorHex,
                    isBold=line.isBold,
                    isItalic=line.isItalic,
                )
            ]

            baseline_y = safe_target_rect.y0 + (float(line.y or 0.0) * scale_y)
            for span in spans:
                if not span.text:
                    continue

                span_font_size = max(float(span.fontSize or line.fontSize or 8.0) * scale_font, 6.0)
                baseline = fitz.Point(
                    safe_target_rect.x0 + (float(span.x or line.x or 0.0) * scale_x),
                    safe_target_rect.y0 + (float(line.y or 0.0) * scale_y) + span_font_size,
                )
                self.insert_text_with_resolved_font(
                    page,
                    baseline,
                    span.text,
                    span.fontName or line.fontName,
                    span_font_size,
                    color_hex_to_rgb_tuple(span.colorHex or line.colorHex, fallback_color),
                    span.isBold,
                    span.isItalic,
                    source_font_resource_name,
                    source_font_postscript_name,
                    source_font_family,
                )

    def clone_text_block_layout(
        self,
        page: fitz.Page,
        source_text_block: InternalTextBlock,
        source_rect: fitz.Rect,
        target_rect: fitz.Rect,
    ) -> None:
        if not source_text_block.spans:
            self.insert_text_with_fallback(
                page,
                target_rect,
                source_text_block.text,
                max(float(source_text_block.font_size or 12.0), 8.0),
                source_text_block.font_name,
                source_text_block.color,
                is_bold=derive_font_traits(source_text_block.font_name)[0],
                is_italic=derive_font_traits(source_text_block.font_name)[1],
                preserve_font_size=True,
            )
            return

        safe_target_rect = fitz.Rect(target_rect)
        if safe_target_rect.width <= 0 or safe_target_rect.height <= 0:
            safe_target_rect = self.ensure_text_rect(target_rect, page.rect, max(float(source_text_block.font_size or 12.0), 8.0))
        source_width = max(source_rect.width, 1.0)
        source_height = max(source_rect.height, 1.0)
        scale_x = safe_target_rect.width / source_width
        scale_y = safe_target_rect.height / source_height
        if abs(safe_target_rect.width - source_rect.width) <= 1.0:
            scale_x = 1.0
        if abs(safe_target_rect.height - source_rect.height) <= 1.0:
            scale_y = 1.0

        for span in source_text_block.spans:
            if not span.text:
                continue

            translated_origin = fitz.Point(
                safe_target_rect.x0 + ((span.origin_x - source_rect.x0) * scale_x),
                safe_target_rect.y0 + ((span.origin_y - source_rect.y0) * scale_y),
            )
            next_font_size = max(span.font_size * min(scale_x, scale_y), 6.0)
            span_is_bold, span_is_italic = derive_font_traits(span.font_name or source_text_block.font_name)
            self.insert_text_with_resolved_font(
                page,
                translated_origin,
                span.text,
                span.font_name or source_text_block.font_name,
                next_font_size,
                span.color or source_text_block.color,
                span_is_bold,
                span_is_italic,
                span.font_resource_name or source_text_block.font_resource_name,
                span.font_postscript_name or source_text_block.font_postscript_name,
                span.font_family or source_text_block.font_family,
            )

    def run_ocr(self, request: RunOcrRequest) -> RunOcrResponse:
        input_path = ensure_existing_file(request.sourcePath)
        output_path = str(Path(request.outputPath).expanduser())
        output_directory = os.path.dirname(output_path)
        if output_directory:
            os.makedirs(output_directory, exist_ok=True)

        normalized_page_range = self.normalize_page_range(request.pageRange)
        language_codes = self.normalize_language_codes(request.languageCode)

        try:
            ocrmypdf.ocr(
                input_path,
                output_path,
                language=language_codes,
                pages=normalized_page_range,
                deskew=bool(request.deskew),
                force_ocr=bool(request.forceOcr),
                skip_text=not bool(request.forceOcr),
                optimize=0,
                jobs=1,
                progress_bar=False,
            )
        except ocrmypdf_exceptions.BadArgsError as exception:
            raise ValueError(str(exception)) from exception
        except ocrmypdf_exceptions.EncryptedPdfError as exception:
            raise ValueError("This PDF is protected. Unlock it before running OCR.") from exception
        except ocrmypdf_exceptions.InputFileError as exception:
            raise ValueError(str(exception)) from exception
        except ocrmypdf_exceptions.MissingDependencyError as exception:
            raise RuntimeError(f"OCR is not available because a required dependency is missing: {exception}") from exception
        except ocrmypdf_exceptions.PriorOcrFoundError as exception:
            raise ValueError("This PDF already has OCR text. Turn on Force OCR only if you truly need to re-run OCR.") from exception
        except ocrmypdf_exceptions.SubprocessOutputError as exception:
            raise RuntimeError(f"OCR failed while processing the PDF: {exception}") from exception
        except Exception as exception:
            raise RuntimeError(f"OCR failed unexpectedly: {exception}") from exception

        if not os.path.isfile(output_path):
            raise RuntimeError("The OCR output PDF was not created.")

        return RunOcrResponse(
            languageCode="+".join(language_codes),
            pageRange=normalized_page_range,
            deskew=bool(request.deskew),
            forceOcr=bool(request.forceOcr),
        )

    def replace_text(self, request: ReplaceTextRequest) -> ReplaceTextResponse:
        input_path = ensure_existing_file(request.sourcePath)
        document = fitz.open(input_path)
        try:
            target_block = self.find_text_block(document, request.textBlockId)
            target_page = target_block.page
            target_rect = fitz.Rect(target_block.bbox)
            font_size = max(float(target_block.font_size or 12.0), 8.0)
            padding_x = min(max(font_size * 0.05, 0.4), 1.0)
            padding_y = min(max(font_size * 0.04, 0.35), 0.8)
            redact_rect = fitz.Rect(
                target_rect.x0 - padding_x,
                target_rect.y0 - padding_y,
                target_rect.x1 + padding_x,
                target_rect.y1 + padding_y,
            )

            target_page.add_redact_annot(redact_rect, fill=(1, 1, 1))
            target_page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

            replacement_text = normalize_editable_text_characters(request.replacementText or "")
            result_text_block = None
            if replacement_text.strip():
                resolved_style = self.resolve_text_style(
                    target_block,
                    request.fontName,
                    request.fontSize,
                    request.colorHex,
                    request.isBold,
                    request.isItalic,
                )
                replacement_rect = fitz.Rect(
                    target_rect.x0,
                    target_rect.y0,
                    target_rect.x1,
                    max(target_rect.y1, target_rect.y0 + font_size * 1.2),
                )
                if self.is_single_line_text_block(target_block):
                    self.insert_single_line_text(
                        target_page,
                        target_block,
                        target_rect,
                        replacement_rect,
                        replacement_text,
                        resolved_style,
                    )
                else:
                    self.insert_multiline_text_layout(
                        target_page,
                        target_block,
                        target_rect,
                        replacement_rect,
                        replacement_text,
                        resolved_style,
                    )

            self.save_document(document, request.outputPath)

            if replacement_text.strip():
                result_text_block = self.find_result_text_block(
                    request.outputPath,
                    target_block.page_number,
                    replacement_text,
                    replacement_rect,
                )

            return ReplaceTextResponse(
                sourceTextBlockId=target_block.text_block_id,
                pageNumber=target_block.page_number,
                originalText=target_block.text,
                replacementText=replacement_text,
                resultTextBlock=result_text_block,
            )
        finally:
            document.close()

    def update_text_layout(self, request: UpdateTextLayoutRequest) -> UpdateTextLayoutResponse:
        input_path = ensure_existing_file(request.sourcePath)
        document = fitz.open(input_path)
        try:
            target_block = self.find_text_block(document, request.textBlockId)
            target_page = target_block.page
            page_rect = target_page.rect
            original_rect = fitz.Rect(target_block.bbox)

            target_rect = fitz.Rect(
                max(min(float(request.x), 1.0), 0.0) * page_rect.width,
                max(min(float(request.y), 1.0), 0.0) * page_rect.height,
                max(min(float(request.x) + float(request.width), 1.0), 0.0) * page_rect.width,
                max(min(float(request.y) + float(request.height), 1.0), 0.0) * page_rect.height,
            )

            if target_rect.width < 8 or target_rect.height < 8:
                raise ValueError("The selected text area is too small to place text there.")

            if not request.keepOriginal:
                padding_x = min(max((float(target_block.font_size) or 12.0) * 0.05, 0.4), 1.0)
                padding_y = min(max((float(target_block.font_size) or 12.0) * 0.04, 0.35), 0.8)
                redact_rect = fitz.Rect(
                    original_rect.x0 - padding_x,
                    original_rect.y0 - padding_y,
                    original_rect.x1 + padding_x,
                    original_rect.y1 + padding_y,
                )
                target_page.add_redact_annot(redact_rect, fill=(1, 1, 1))
                target_page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

            replacement_text = normalize_editable_text_characters(request.text or target_block.text)
            resolved_style = self.resolve_text_style(
                target_block,
                request.fontName,
                request.fontSize,
                request.colorHex,
                request.isBold,
                request.isItalic,
            )
            if (
                normalize_text(replacement_text) == normalize_text(target_block.text)
                and self.style_matches_source_text_block(target_block, resolved_style)
            ):
                self.clone_text_block_layout(
                    target_page,
                    target_block,
                    original_rect,
                    target_rect,
                )
            elif self.is_single_line_text_block(target_block):
                self.insert_single_line_text(
                    target_page,
                    target_block,
                    original_rect,
                    target_rect,
                    replacement_text,
                    resolved_style,
                )
            else:
                self.insert_multiline_text_layout(
                    target_page,
                    target_block,
                    original_rect,
                    target_rect,
                    replacement_text,
                    resolved_style,
                )

            self.save_document(document, request.outputPath)

            result_text_block = self.find_result_text_block(
                request.outputPath,
                target_block.page_number,
                replacement_text,
                target_rect,
                {target_block.text_block_id} if request.keepOriginal else set(),
            )

            return UpdateTextLayoutResponse(
                sourceTextBlockId=target_block.text_block_id,
                text=replacement_text,
                pageNumber=target_block.page_number,
                keepOriginal=bool(request.keepOriginal),
                resultTextBlock=result_text_block,
            )
        finally:
            document.close()


text_engine_service = TextEngineService()
