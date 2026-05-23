from __future__ import annotations

from pydantic import Field

from pdf_editor_document_engine.models.text import DetectedTextBlockModel, DocumentEngineModel


class DocumentPageModel(DocumentEngineModel):
    pageNumber: int
    width: float
    height: float
    rotation: int


class DocumentEngineCapabilityModel(DocumentEngineModel):
    capabilityName: str
    isAvailable: bool
    description: str = ""


class DocumentEngineCapabilitiesResponse(DocumentEngineModel):
    serviceName: str
    version: str
    capabilities: list[DocumentEngineCapabilityModel]


class DocumentSnapshotRequest(DocumentEngineModel):
    sourcePath: str = Field(min_length=1)


class DocumentSnapshotResponse(DocumentEngineModel):
    serviceName: str
    version: str
    documentFingerprintSha256: str
    pageCount: int
    pages: list[DocumentPageModel]
    textBlocks: list[DetectedTextBlockModel]
    capabilities: list[DocumentEngineCapabilityModel]
