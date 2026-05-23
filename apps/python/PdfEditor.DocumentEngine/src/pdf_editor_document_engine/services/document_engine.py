from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path

import fitz

from pdf_editor_document_engine.models.document import (
    DocumentEngineCapabilitiesResponse,
    DocumentEngineCapabilityModel,
    DocumentPageModel,
    DocumentSnapshotResponse,
)
from pdf_editor_document_engine.services.text_engine import ensure_existing_file, text_engine_service

SERVICE_NAME = "PdfEditor.DocumentEngine"
SERVICE_VERSION = "0.3.1"


class DocumentEngineService:
    def get_capabilities(self) -> DocumentEngineCapabilitiesResponse:
        return DocumentEngineCapabilitiesResponse(
            serviceName=SERVICE_NAME,
            version=SERVICE_VERSION,
            capabilities=[
                DocumentEngineCapabilityModel(
                    capabilityName="document-snapshot",
                    isAvailable=True,
                    description="Extracts stable page and text metadata for editor sessions.",
                ),
                DocumentEngineCapabilityModel(
                    capabilityName="text-extraction",
                    isAvailable=True,
                    description="Extracts editable text blocks from text-based PDFs.",
                ),
                DocumentEngineCapabilityModel(
                    capabilityName="text-replacement",
                    isAvailable=True,
                    description="Rewrites detected PDF text blocks into a new output document.",
                ),
                DocumentEngineCapabilityModel(
                    capabilityName="text-layout-update",
                    isAvailable=True,
                    description="Moves, resizes, and duplicates text blocks in a new output document.",
                ),
                DocumentEngineCapabilityModel(
                    capabilityName="ocr",
                    isAvailable=self.is_ocr_ready(),
                    description="Supports OCR-backed editing when the local OCR toolchain is available.",
                ),
                DocumentEngineCapabilityModel(
                    capabilityName="image-object-editing",
                    isAvailable=False,
                    description="Reserved for the upcoming image/object editing pipeline.",
                ),
                DocumentEngineCapabilityModel(
                    capabilityName="organize-tools",
                    isAvailable=False,
                    description="Reserved for the upcoming extract/insert/replace/crop/page-label engine.",
                ),
            ],
        )

    def extract_document_snapshot(self, source_path: str) -> DocumentSnapshotResponse:
        input_path = ensure_existing_file(source_path)
        document = fitz.open(input_path)
        try:
            pages = [
                DocumentPageModel(
                    pageNumber=index + 1,
                    width=float(document[index].rect.width),
                    height=float(document[index].rect.height),
                    rotation=int(document[index].rotation or 0),
                )
                for index in range(document.page_count)
            ]
        finally:
            document.close()

        return DocumentSnapshotResponse(
            serviceName=SERVICE_NAME,
            version=SERVICE_VERSION,
            documentFingerprintSha256=self.compute_file_sha256(input_path),
            pageCount=len(pages),
            pages=pages,
            textBlocks=text_engine_service.extract_text_blocks(input_path),
            capabilities=self.get_capabilities().capabilities,
        )

    def is_ocr_ready(self) -> bool:
        return self._has_command("tesseract") and (self._has_command("ocrmypdf") or self._python_module_exists("ocrmypdf"))

    def _has_command(self, command_name: str) -> bool:
        return shutil.which(command_name) is not None

    def _python_module_exists(self, module_name: str) -> bool:
        try:
            __import__(module_name)
            return True
        except Exception:
            return False

    def compute_file_sha256(self, source_path: str) -> str:
        digest = hashlib.sha256()
        with open(Path(source_path), "rb") as file_stream:
            while True:
                chunk = file_stream.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        return digest.hexdigest()


document_engine_service = DocumentEngineService()
