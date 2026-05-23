from __future__ import annotations

from fastapi import APIRouter

from pdf_editor_document_engine.models.document import (
    DocumentEngineCapabilitiesResponse,
    DocumentSnapshotRequest,
    DocumentSnapshotResponse,
)
from pdf_editor_document_engine.services.document_engine import document_engine_service

router = APIRouter(prefix="/api/v1/engine", tags=["Engine"])


@router.get("/capabilities", response_model=DocumentEngineCapabilitiesResponse)
async def get_capabilities() -> DocumentEngineCapabilitiesResponse:
    return document_engine_service.get_capabilities()


@router.post("/snapshot", response_model=DocumentSnapshotResponse)
async def get_document_snapshot(request: DocumentSnapshotRequest) -> DocumentSnapshotResponse:
    return document_engine_service.extract_document_snapshot(request.sourcePath)
