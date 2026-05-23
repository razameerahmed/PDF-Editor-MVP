from __future__ import annotations

from fastapi import APIRouter

from pdf_editor_document_engine.services.document_engine import SERVICE_NAME, SERVICE_VERSION

router = APIRouter(tags=["Health"])


@router.get("/health")
async def get_health() -> dict[str, str]:
    return {
        "status": "ok",
        "serviceName": SERVICE_NAME,
        "version": SERVICE_VERSION,
    }
