from __future__ import annotations

import io
import os
import re
import tempfile
from hashlib import sha256
from dataclasses import dataclass
from pathlib import Path

import fitz
from fontTools.ttLib import TTCollection, TTFont
try:
    import uharfbuzz as hb
except ImportError:  # pragma: no cover - optional shaping dependency
    hb = None

try:
    import winreg
except ImportError:  # pragma: no cover - non-Windows fallback
    winreg = None


FONT_REGISTRY_PATHS = (
    r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Fonts",
)

KNOWN_STYLE_SUFFIXES = (
    " bold italic",
    " bold",
    " italic",
    " regular",
    " light",
    " semibold",
    " semi bold",
    " medium",
    " black",
)


def normalize_font_name(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).strip().lower()


def normalize_registry_font_name(value: str | None) -> str:
    normalized = re.sub(
        r"\s*\((truetype|opentype|raster)\)\s*$",
        "",
        str(value or "").strip(),
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized[1:] if normalized.startswith("@") else normalized


def normalize_font_family_name(value: str | None) -> str:
    normalized = normalize_registry_font_name(value)
    lowered = normalized.lower()
    for suffix in KNOWN_STYLE_SUFFIXES:
        if lowered.endswith(suffix):
            return normalized[: -len(suffix)].strip()
    return normalized


def strip_subset_prefix(value: str | None) -> str:
    normalized = str(value or "").strip()
    if re.match(r"^[A-Z]{6}\+", normalized):
        return normalized[7:]
    return normalized


def sanitize_font_alias(value: str) -> str:
    safe_value = re.sub(r"[^A-Za-z0-9_]", "_", value or "font")
    if not safe_value or safe_value[0].isdigit():
        safe_value = f"F_{safe_value}"
    return safe_value[:48]


@dataclass(slots=True)
class InstalledFontEntry:
    display_name: str
    family_name: str
    file_path: str
    collection_index: int | None = None


@dataclass(slots=True)
class PageFontCatalogEntry:
    font_xref: int
    font_ext: str
    font_type: str
    base_name: str
    resource_name: str
    encoding: str
    extracted_font_name: str
    family_name: str
    full_name: str
    postscript_name: str
    font_data: bytes
    font_format: str
    font_file_path: str | None
    to_unicode_available: bool
    can_embed_for_editing: bool
    warning: str | None


@dataclass(slots=True)
class ResolvedFontResource:
    requested_font_name: str
    resolved_font_name: str
    font_source: str
    font_format: str
    font_data: bytes
    fitz_font: fitz.Font
    font_resource_name: str = ""
    font_postscript_name: str = ""
    font_family: str = ""
    font_xref: int | None = None
    font_type: str = ""
    to_unicode_available: bool = False
    can_embed_for_editing: bool = True
    font_resolution_status: str = "exact-source"
    missing_glyphs: tuple[str, ...] = ()
    font_file_path: str | None = None
    is_fallback: bool = False
    warning: str | None = None

    @property
    def content_type(self) -> str:
        return {
            "otf": "font/otf",
            "ttf": "font/ttf",
            "ttc": "font/collection",
            "otc": "font/collection",
        }.get(self.font_format.lower(), "application/octet-stream")

    @property
    def browser_family_name(self) -> str:
        return self.resolved_font_name or self.requested_font_name or "PdfEditorFont"


class FontRegistry:
    def __init__(self) -> None:
        self._installed_font_entries: list[InstalledFontEntry] | None = None
        self._installed_font_lookup: dict[str, list[InstalledFontEntry]] = {}
        self._installed_font_family_lookup: dict[str, list[InstalledFontEntry]] = {}
        self._font_resource_cache: dict[tuple[str, int, str, str, str, int, int, str], ResolvedFontResource] = {}
        self._page_font_catalog_cache: dict[tuple[str, int], list[PageFontCatalogEntry]] = {}
        self._page_font_alias_cache: dict[tuple[int, str], str] = {}
        self._materialized_font_file_cache: dict[tuple[str, str], str] = {}

    def resolve_font_resource(
        self,
        document: fitz.Document | None,
        page: fitz.Page | None,
        requested_font_name: str,
        is_bold: bool | None = None,
        is_italic: bool | None = None,
        text_sample: str | None = None,
        source_font_resource_name: str | None = None,
        source_font_postscript_name: str | None = None,
        source_font_family: str | None = None,
    ) -> ResolvedFontResource:
        normalized_name = normalize_font_name(requested_font_name)
        normalized_resource_name = normalize_font_name(source_font_resource_name)
        normalized_postscript_name = normalize_font_name(source_font_postscript_name)
        text_signature = self._build_text_signature(text_sample)
        cache_key = (
            str(getattr(document, "name", "") or ""),
            int(getattr(page, "xref", 0) or 0),
            normalized_name,
            normalized_resource_name,
            normalized_postscript_name,
            1 if bool(is_bold) else 0,
            1 if bool(is_italic) else 0,
            text_signature,
        )
        cached_resource = self._font_resource_cache.get(cache_key)
        if cached_resource is not None:
            return cached_resource

        resolved_resource = self._resolve_embedded_font(
            document,
            page,
            requested_font_name,
            is_bold,
            is_italic,
            text_sample,
            source_font_resource_name=source_font_resource_name,
            source_font_postscript_name=source_font_postscript_name,
            source_font_family=source_font_family,
        )
        if resolved_resource is None:
            resolved_resource = self._resolve_installed_font(
                requested_font_name,
                is_bold,
                is_italic,
                text_sample,
                source_font_postscript_name=source_font_postscript_name,
                source_font_family=source_font_family,
            )
        if resolved_resource is None:
            resolved_resource = self._resolve_builtin_font(
                requested_font_name,
                is_bold,
                is_italic,
                text_sample,
                source_font_postscript_name=source_font_postscript_name,
                source_font_family=source_font_family,
            )

        self._font_resource_cache[cache_key] = resolved_resource
        return resolved_resource

    def resolve_source_font_reference(
        self,
        document: fitz.Document | None,
        page: fitz.Page | None,
        requested_font_name: str,
        is_bold: bool | None = None,
        is_italic: bool | None = None,
        source_font_resource_name: str | None = None,
        source_font_postscript_name: str | None = None,
        source_font_family: str | None = None,
    ) -> PageFontCatalogEntry | None:
        if document is None or page is None:
            return None

        catalog = self._collect_page_font_catalog(document, page)
        requested_name = normalize_font_name(requested_font_name)
        requested_family = normalize_font_name(normalize_font_family_name(requested_font_name))
        requested_postscript = normalize_font_name(source_font_postscript_name or requested_font_name)
        requested_resource_name = normalize_font_name(source_font_resource_name)
        source_family_key = normalize_font_name(source_font_family)
        best_entry: tuple[int, PageFontCatalogEntry] | None = None

        for entry in catalog:
            score = self._score_page_font_entry(
                entry,
                requested_name,
                requested_family,
                requested_postscript,
                requested_resource_name,
                source_family_key,
                is_bold,
                is_italic,
            )
            if score <= 0:
                continue

            if best_entry is None or score > best_entry[0]:
                best_entry = (score, entry)

        return best_entry[1] if best_entry is not None else None

    def measure_text(
        self,
        text: str,
        font_name: str,
        font_size: float,
        document: fitz.Document | None = None,
        page: fitz.Page | None = None,
        is_bold: bool | None = None,
        is_italic: bool | None = None,
    ) -> float:
        if not text:
            return 0.0

        font_resource = self.resolve_font_resource(document, page, font_name, is_bold, is_italic, text_sample=text)
        shaped_width = self._measure_text_with_harfbuzz(font_resource.font_data, text, font_size)
        if shaped_width > 0.0:
            return shaped_width

        return max(font_resource.fitz_font.text_length(text, fontsize=max(float(font_size or 0.0), 6.0)), 0.0)

    def ensure_page_font_alias(
        self,
        page: fitz.Page,
        font_resource: ResolvedFontResource,
    ) -> str:
        if font_resource.font_source == "builtin":
            return font_resource.resolved_font_name

        cache_key = (page.xref, font_resource.resolved_font_name)
        cached_alias = self._page_font_alias_cache.get(cache_key)
        if cached_alias is not None:
            return cached_alias

        alias = sanitize_font_alias(f"{font_resource.resolved_font_name}_{abs(hash(cache_key))}")
        if font_resource.font_file_path:
            page.insert_font(fontname=alias, fontfile=font_resource.font_file_path)
        else:
            page.insert_font(fontname=alias, fontbuffer=font_resource.font_data)
        self._page_font_alias_cache[cache_key] = alias
        return alias

    def _resolve_embedded_font(
        self,
        document: fitz.Document | None,
        page: fitz.Page | None,
        requested_font_name: str,
        is_bold: bool | None,
        is_italic: bool | None,
        text_sample: str | None,
        *,
        source_font_resource_name: str | None = None,
        source_font_postscript_name: str | None = None,
        source_font_family: str | None = None,
    ) -> ResolvedFontResource | None:
        if document is None or page is None:
            return None

        font_entry = self.resolve_source_font_reference(
            document,
            page,
            requested_font_name,
            is_bold,
            is_italic,
            source_font_resource_name=source_font_resource_name,
            source_font_postscript_name=source_font_postscript_name,
            source_font_family=source_font_family,
        )
        if font_entry is None or not font_entry.font_data:
            return None

        fitz_font = fitz.Font(fontbuffer=font_entry.font_data)
        missing_glyphs = tuple(self._collect_missing_glyphs(fitz_font, text_sample))
        resolved_resource = ResolvedFontResource(
            requested_font_name=str(requested_font_name or font_entry.base_name or "EmbeddedFont"),
            resolved_font_name=font_entry.full_name or font_entry.base_name or requested_font_name,
            font_source="embedded",
            font_format=font_entry.font_format,
            font_data=font_entry.font_data,
            fitz_font=fitz_font,
            font_resource_name=font_entry.resource_name,
            font_postscript_name=font_entry.postscript_name,
            font_family=font_entry.family_name or normalize_font_family_name(font_entry.base_name),
            font_xref=font_entry.font_xref,
            font_type=font_entry.font_type,
            to_unicode_available=font_entry.to_unicode_available,
            can_embed_for_editing=font_entry.can_embed_for_editing and not missing_glyphs,
            font_resolution_status="exact-source" if not missing_glyphs and font_entry.can_embed_for_editing else "source-limited",
            missing_glyphs=missing_glyphs,
            font_file_path=font_entry.font_file_path,
            is_fallback=bool(missing_glyphs) or not font_entry.can_embed_for_editing,
            warning=font_entry.warning,
        )
        if missing_glyphs:
            warning_prefix = resolved_resource.warning or ""
            resolved_resource.warning = (warning_prefix + " " if warning_prefix else "") + (
                "The source PDF font is available, but it cannot represent all edited characters exactly."
            )
        return resolved_resource

    def _resolve_installed_font(
        self,
        requested_font_name: str,
        is_bold: bool | None,
        is_italic: bool | None,
        text_sample: str | None,
        *,
        source_font_postscript_name: str | None = None,
        source_font_family: str | None = None,
    ) -> ResolvedFontResource | None:
        self._ensure_installed_fonts_loaded()
        requested_key = normalize_font_name(requested_font_name)
        requested_family_key = normalize_font_name(normalize_font_family_name(requested_font_name))
        requested_postscript_key = normalize_font_name(source_font_postscript_name or requested_font_name)
        source_family_key = normalize_font_name(source_font_family)

        candidates = self._installed_font_lookup.get(requested_key, [])
        if not candidates:
            candidates = self._installed_font_family_lookup.get(requested_family_key, [])
        if not candidates and source_family_key:
            candidates = self._installed_font_family_lookup.get(source_family_key, [])
        if not candidates:
            return None

        best_candidate: tuple[int, InstalledFontEntry] | None = None
        for candidate in candidates:
            display_key = normalize_font_name(candidate.display_name)
            family_key = normalize_font_name(candidate.family_name)
            candidate_bold = any(token in display_key for token in ("bold", "black", "semibold", "demi"))
            candidate_italic = any(token in display_key for token in ("italic", "oblique"))

            score = 0
            if display_key == requested_key:
                score += 20
            elif display_key == requested_postscript_key:
                score += 18
            elif family_key == requested_family_key:
                score += 12
            elif source_family_key and family_key == source_family_key:
                score += 10
            if is_bold is not None and candidate_bold == bool(is_bold):
                score += 4
            if is_italic is not None and candidate_italic == bool(is_italic):
                score += 4

            if best_candidate is None or score > best_candidate[0]:
                best_candidate = (score, candidate)

        if best_candidate is None:
            return None

        _, matched_entry = best_candidate
        font_data, font_format = self._load_font_bytes(
            matched_entry.file_path,
            matched_entry.display_name,
            is_bold,
            is_italic,
            collection_index=matched_entry.collection_index,
        )
        warning = self._get_embedding_warning(font_data)
        fitz_font = fitz.Font(fontbuffer=font_data)
        missing_glyphs = tuple(self._collect_missing_glyphs(fitz_font, text_sample))
        font_names = self._extract_font_names(TTFont(io.BytesIO(font_data)))
        is_exact_match = (
            normalize_font_name(matched_entry.display_name) == requested_key
            or normalize_font_name(font_names["postscript_name"]) == requested_postscript_key
        )
        resolved_resource = ResolvedFontResource(
            requested_font_name=str(requested_font_name or matched_entry.display_name),
            resolved_font_name=matched_entry.display_name,
            font_source="installed",
            font_format=font_format,
            font_data=font_data,
            fitz_font=fitz_font,
            font_postscript_name=font_names["postscript_name"],
            font_family=font_names["family_name"] or matched_entry.family_name,
            can_embed_for_editing=(warning is None) and not missing_glyphs,
            font_resolution_status="installed-exact" if is_exact_match and not missing_glyphs else "installed-substitute",
            missing_glyphs=missing_glyphs,
            font_file_path=matched_entry.file_path if Path(matched_entry.file_path).suffix.lower() not in {".ttc", ".otc"} else self._materialize_font_file(font_data, font_format, matched_entry.display_name),
            is_fallback=not is_exact_match or bool(missing_glyphs) or warning is not None,
            warning=warning,
        )
        if missing_glyphs:
            warning_prefix = resolved_resource.warning or ""
            resolved_resource.warning = (warning_prefix + " " if warning_prefix else "") + (
                "The installed replacement font is missing some edited characters."
            )
        elif not is_exact_match:
            warning_prefix = resolved_resource.warning or ""
            resolved_resource.warning = (warning_prefix + " " if warning_prefix else "") + (
                f"The editor matched '{matched_entry.display_name}' from the server font catalog instead of the exact source font."
            )
        return resolved_resource

    def _resolve_builtin_font(
        self,
        requested_font_name: str,
        is_bold: bool | None,
        is_italic: bool | None,
        text_sample: str | None,
        *,
        source_font_postscript_name: str | None = None,
        source_font_family: str | None = None,
    ) -> ResolvedFontResource:
        builtin_font_name = self._resolve_builtin_font_name(requested_font_name, is_bold, is_italic)
        builtin_font = fitz.Font(fontname=builtin_font_name)
        missing_glyphs = tuple(self._collect_missing_glyphs(builtin_font, text_sample))
        warning_suffix = "" if not missing_glyphs else " Some edited characters may not be supported by that fallback font."
        return ResolvedFontResource(
            requested_font_name=str(requested_font_name or builtin_font_name),
            resolved_font_name=builtin_font_name,
            font_source="builtin",
            font_format="ttf",
            font_data=builtin_font.buffer,
            fitz_font=builtin_font,
            font_postscript_name=str(source_font_postscript_name or ""),
            font_family=str(source_font_family or normalize_font_family_name(requested_font_name or builtin_font_name)),
            can_embed_for_editing=False,
            font_resolution_status="builtin-fallback",
            missing_glyphs=missing_glyphs,
            font_file_path=None,
            is_fallback=True,
            warning=f"The exact font '{requested_font_name}' was not available, so the editor used {builtin_font_name}.{warning_suffix}",
        )

    def _ensure_installed_fonts_loaded(self) -> None:
        if self._installed_font_entries is not None:
            return

        entries: list[InstalledFontEntry] = []
        if os.name == "nt" and winreg is not None:
            fonts_root = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
            for registry_hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                for registry_path in FONT_REGISTRY_PATHS:
                    try:
                        with winreg.OpenKey(registry_hive, registry_path) as registry_key:
                            value_index = 0
                            while True:
                                try:
                                    raw_name, raw_file, _ = winreg.EnumValue(registry_key, value_index)
                                except OSError:
                                    break

                                value_index += 1
                                normalized_name = normalize_registry_font_name(raw_name)
                                if not normalized_name or str(raw_file or "").strip() == "":
                                    continue

                                file_value = str(raw_file).strip().strip('"')
                                file_path = Path(file_value)
                                if not file_path.is_absolute():
                                    file_path = fonts_root / file_path
                                if not file_path.is_file():
                                    continue

                                if file_path.suffix.lower() in {".ttc", ".otc"}:
                                    entries.extend(self._enumerate_collection_entries(file_path))
                                    continue

                                entries.append(
                                    InstalledFontEntry(
                                        display_name=normalized_name,
                                        family_name=normalize_font_family_name(normalized_name),
                                        file_path=str(file_path),
                                    )
                                )
                    except OSError:
                        continue

        self._installed_font_entries = entries
        self._installed_font_lookup = {}
        self._installed_font_family_lookup = {}
        for entry in entries:
            self._installed_font_lookup.setdefault(normalize_font_name(entry.display_name), []).append(entry)
            self._installed_font_family_lookup.setdefault(normalize_font_name(entry.family_name), []).append(entry)

    def _load_font_bytes(
        self,
        file_path: str,
        requested_font_name: str,
        is_bold: bool | None,
        is_italic: bool | None,
        collection_index: int | None = None,
    ) -> tuple[bytes, str]:
        font_path = Path(file_path)
        extension = font_path.suffix.lower().lstrip(".")
        if extension not in {"ttc", "otc"}:
            return font_path.read_bytes(), extension or "ttf"

        collection = TTCollection(str(font_path))
        if collection_index is not None and 0 <= collection_index < len(collection.fonts):
            font_buffer = io.BytesIO()
            collection.fonts[collection_index].save(font_buffer)
            return font_buffer.getvalue(), "ttf"

        best_match: tuple[int, TTFont] | None = None
        requested_key = normalize_font_name(requested_font_name)
        requested_family_key = normalize_font_name(normalize_font_family_name(requested_font_name))
        for candidate_font in collection.fonts:
            candidate_names = self._extract_font_names(candidate_font)
            display_name = candidate_names["full_name"] or candidate_names["family_name"]
            display_key = normalize_font_name(display_name)
            family_key = normalize_font_name(candidate_names["family_name"] or display_name)
            candidate_bold = any(token in display_key for token in ("bold", "black", "semibold", "demi"))
            candidate_italic = any(token in display_key for token in ("italic", "oblique"))

            score = 0
            if display_key == requested_key:
                score += 20
            elif family_key == requested_family_key:
                score += 12
            if is_bold is not None and candidate_bold == bool(is_bold):
                score += 4
            if is_italic is not None and candidate_italic == bool(is_italic):
                score += 4

            if best_match is None or score > best_match[0]:
                best_match = (score, candidate_font)

        if best_match is None:
            raise FileNotFoundError(f"The font collection could not resolve {requested_font_name}.")

        font_buffer = io.BytesIO()
        best_match[1].save(font_buffer)
        return font_buffer.getvalue(), "ttf"

    def _collect_page_font_catalog(self, document: fitz.Document, page: fitz.Page) -> list[PageFontCatalogEntry]:
        cache_key = (str(getattr(document, "name", "") or ""), int(getattr(page, "xref", 0) or 0))
        cached_catalog = self._page_font_catalog_cache.get(cache_key)
        if cached_catalog is not None:
            return cached_catalog

        catalog: list[PageFontCatalogEntry] = []
        for font_xref, font_ext, font_type, embedded_font_name, resource_name, encoding, _ in page.get_fonts(full=True):
            try:
                extracted_font_name, extracted_font_ext, _, font_data = document.extract_font(font_xref)
            except Exception:
                extracted_font_name, extracted_font_ext, font_data = "", font_ext, b""

            font_bytes = bytes(font_data or b"")
            family_name = normalize_font_family_name(embedded_font_name or extracted_font_name)
            full_name = strip_subset_prefix(embedded_font_name or extracted_font_name)
            postscript_name = strip_subset_prefix(extracted_font_name or embedded_font_name)
            font_format = str(extracted_font_ext or font_ext or "ttf").lower()
            font_file_path = None
            warning = None
            can_embed_for_editing = False

            if font_bytes:
                try:
                    tt_font = TTFont(io.BytesIO(font_bytes))
                    font_names = self._extract_font_names(tt_font)
                    family_name = font_names["family_name"] or family_name
                    full_name = font_names["full_name"] or full_name
                    postscript_name = font_names["postscript_name"] or postscript_name
                    warning = self._get_embedding_warning(font_bytes)
                    can_embed_for_editing = warning is None
                except Exception:
                    pass

                try:
                    font_file_path = self._materialize_font_file(font_bytes, font_format, full_name or postscript_name or embedded_font_name or "font")
                except Exception:
                    font_file_path = None

            to_unicode_key = document.xref_get_key(int(font_xref), "ToUnicode")
            to_unicode_available = str(to_unicode_key[0]).lower() == "xref" and bool(str(to_unicode_key[1]).strip())

            catalog.append(
                PageFontCatalogEntry(
                    font_xref=int(font_xref),
                    font_ext=str(font_ext or ""),
                    font_type=str(font_type or ""),
                    base_name=strip_subset_prefix(embedded_font_name or extracted_font_name),
                    resource_name=str(resource_name or ""),
                    encoding=str(encoding or ""),
                    extracted_font_name=str(extracted_font_name or embedded_font_name or ""),
                    family_name=str(family_name or ""),
                    full_name=str(full_name or family_name or embedded_font_name or ""),
                    postscript_name=str(postscript_name or full_name or embedded_font_name or ""),
                    font_data=font_bytes,
                    font_format=font_format,
                    font_file_path=font_file_path,
                    to_unicode_available=to_unicode_available,
                    can_embed_for_editing=can_embed_for_editing,
                    warning=warning,
                )
            )

        self._page_font_catalog_cache[cache_key] = catalog
        return catalog

    def _enumerate_collection_entries(self, file_path: Path) -> list[InstalledFontEntry]:
        entries: list[InstalledFontEntry] = []
        try:
            collection = TTCollection(str(file_path))
        except Exception:
            return entries

        for font_index, font in enumerate(collection.fonts):
            font_names = self._extract_font_names(font)
            display_name = normalize_registry_font_name(font_names["full_name"] or font_names["family_name"])
            family_name = normalize_font_family_name(font_names["family_name"] or display_name)
            if not display_name:
                continue

            entries.append(
                InstalledFontEntry(
                    display_name=display_name,
                    family_name=family_name,
                    file_path=str(file_path),
                    collection_index=font_index,
                )
            )

        return entries

    def _materialize_font_file(self, font_data: bytes, font_format: str, font_name: str) -> str:
        normalized_extension = (font_format or "ttf").lower().lstrip(".")
        if normalized_extension not in {"ttf", "otf"}:
            normalized_extension = "ttf"

        hash_value = sha256(font_data).hexdigest()
        cache_key = (hash_value, normalized_extension)
        cached_path = self._materialized_font_file_cache.get(cache_key)
        if cached_path and Path(cached_path).is_file():
            return cached_path

        cache_directory = Path(tempfile.gettempdir()) / "pdfeditor-font-cache"
        cache_directory.mkdir(parents=True, exist_ok=True)
        safe_name = sanitize_font_alias(font_name or "font").lower()
        output_path = cache_directory / f"{safe_name}_{hash_value[:16]}.{normalized_extension}"
        if not output_path.is_file():
            output_path.write_bytes(font_data)

        output_path_string = str(output_path)
        self._materialized_font_file_cache[cache_key] = output_path_string
        return output_path_string

    @staticmethod
    def _build_text_signature(text_sample: str | None) -> str:
        if not text_sample:
            return ""

        unique_characters = sorted({character for character in text_sample if not character.isspace()})
        return "".join(unique_characters[:64])

    @staticmethod
    def _collect_missing_glyphs(font: fitz.Font, text_sample: str | None) -> list[str]:
        if not text_sample:
            return []

        missing_glyphs: list[str] = []
        for character in text_sample:
            if character.isspace():
                continue

            try:
                if font.has_glyph(ord(character)) <= 0:
                    missing_glyphs.append(character)
            except Exception:
                missing_glyphs.append(character)

        return sorted(set(missing_glyphs))

    @staticmethod
    def _extract_font_names(font: TTFont) -> dict[str, str]:
        family_name = ""
        full_name = ""
        postscript_name = ""
        for record in font["name"].names:
            try:
                decoded = record.toUnicode().strip()
            except Exception:
                continue
            if not decoded:
                continue
            if record.nameID == 1 and not family_name:
                family_name = decoded
            elif record.nameID == 4 and not full_name:
                full_name = decoded
            elif record.nameID == 6 and not postscript_name:
                postscript_name = decoded
        return {
            "family_name": family_name,
            "full_name": full_name or family_name,
            "postscript_name": postscript_name,
        }

    @staticmethod
    def _get_embedding_warning(font_data: bytes) -> str | None:
        try:
            font = TTFont(io.BytesIO(font_data))
        except Exception:
            return None

        os2_table = font.get("OS/2")
        if os2_table is None:
            return None

        fs_type = int(getattr(os2_table, "fsType", 0) or 0)
        if fs_type & 0x0002:
            return "The selected font does not allow editable embedding, so save may require a fallback."
        return None

    @staticmethod
    def _resolve_builtin_font_name(font_name: str, is_bold: bool | None = None, is_italic: bool | None = None) -> str:
        lower_name = normalize_font_name(font_name)
        resolved_is_bold = (
            bool(is_bold)
            if is_bold is not None
            else any(token in lower_name for token in ("bold", "black", "semibold", "demi"))
        )
        resolved_is_italic = (
            bool(is_italic)
            if is_italic is not None
            else any(token in lower_name for token in ("italic", "oblique"))
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
    def _score_page_font_entry(
        entry: PageFontCatalogEntry,
        requested_name: str,
        requested_family: str,
        requested_postscript: str,
        requested_resource_name: str,
        source_family_name: str,
        is_bold: bool | None,
        is_italic: bool | None,
    ) -> int:
        entry_names = {
            normalize_font_name(entry.base_name),
            normalize_font_name(entry.extracted_font_name),
            normalize_font_name(entry.full_name),
            normalize_font_name(entry.postscript_name),
        }
        entry_family_name = normalize_font_name(entry.family_name)
        entry_resource_name = normalize_font_name(entry.resource_name)
        score = 0

        if requested_resource_name and entry_resource_name == requested_resource_name:
            score += 100
        if requested_postscript and normalize_font_name(entry.postscript_name) == requested_postscript:
            score += 80
        if requested_name and requested_name in entry_names:
            score += 50
        elif requested_family and entry_family_name == requested_family:
            score += 30
        elif source_family_name and entry_family_name == source_family_name:
            score += 20

        normalized_name = normalize_font_name(entry.full_name or entry.base_name)
        entry_is_bold = any(token in normalized_name for token in ("bold", "black", "semibold", "demi"))
        entry_is_italic = any(token in normalized_name for token in ("italic", "oblique"))
        if is_bold is not None and entry_is_bold == bool(is_bold):
            score += 4
        if is_italic is not None and entry_is_italic == bool(is_italic):
            score += 4
        if entry.to_unicode_available:
            score += 2

        return score

    @staticmethod
    def _measure_text_with_harfbuzz(font_data: bytes, text: str, font_size: float) -> float:
        if hb is None or not font_data or not text:
            return 0.0

        try:
            face = hb.Face(font_data)
            hb_font = hb.Font(face)
            units_per_em = max(int(face.upem), 1)
            hb_font.scale = (units_per_em, units_per_em)
            buffer = hb.Buffer()
            buffer.add_str(text)
            buffer.guess_segment_properties()
            hb.shape(hb_font, buffer)
            total_advance = sum(int(position.x_advance) for position in buffer.glyph_positions)
            return (float(total_advance) / float(units_per_em)) * max(float(font_size or 0.0), 6.0)
        except Exception:
            return 0.0
