from __future__ import annotations

from fastapi import APIRouter

from pdf_editor_document_engine.models.text import (
    PreviewTextLayoutRequest,
    PreviewTextLayoutResponse,
    ResolveFontResourceRequest,
    ResolveFontResourceResponse,
    ReplaceTextRequest,
    ReplaceTextResponse,
    RunOcrRequest,
    RunOcrResponse,
    TextBlockExtractionRequest,
    TextBlockExtractionResponse,
    TextOverlayCommitRequest,
    TextOverlayCommitResponse,
    UpdateTextLayoutRequest,
    UpdateTextLayoutResponse,
)
from pdf_editor_document_engine.services.text_engine import text_engine_service

router = APIRouter(prefix="/api/v1/text", tags=["Text"])


@router.post("/extract", response_model=TextBlockExtractionResponse)
async def extract_text_blocks(request: TextBlockExtractionRequest) -> TextBlockExtractionResponse:
    return TextBlockExtractionResponse(textBlocks=text_engine_service.extract_text_blocks(request.sourcePath))


@router.post("/replace", response_model=ReplaceTextResponse)
async def replace_text(request: ReplaceTextRequest) -> ReplaceTextResponse:
    return text_engine_service.replace_text(request)


@router.post("/layout", response_model=UpdateTextLayoutResponse)
async def update_text_layout(request: UpdateTextLayoutRequest) -> UpdateTextLayoutResponse:
    return text_engine_service.update_text_layout(request)


@router.post("/preview-layout", response_model=PreviewTextLayoutResponse)
async def preview_text_layout(request: PreviewTextLayoutRequest) -> PreviewTextLayoutResponse:
    return text_engine_service.preview_text_layout(request)


@router.post("/resolve-font", response_model=ResolveFontResourceResponse)
async def resolve_font_resource(request: ResolveFontResourceRequest) -> ResolveFontResourceResponse:
    return text_engine_service.resolve_font_resource_request(request)


@router.post("/apply-overlays", response_model=TextOverlayCommitResponse)
async def apply_text_overlays(request: TextOverlayCommitRequest) -> TextOverlayCommitResponse:
    return text_engine_service.apply_text_overlays(request)


@router.post("/ocr", response_model=RunOcrResponse)
async def run_ocr(request: RunOcrRequest) -> RunOcrResponse:
    return text_engine_service.run_ocr(request)
