from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn


def configure_python_path() -> None:
    project_root = Path(__file__).resolve().parent
    source_root = project_root / "src"
    source_root_value = str(source_root)
    if source_root_value not in sys.path:
        sys.path.insert(0, source_root_value)


def main() -> None:
    configure_python_path()

    host = os.environ.get("PDFEDITOR_DOCUMENT_ENGINE_HOST", "127.0.0.1")
    port = int(os.environ.get("PDFEDITOR_DOCUMENT_ENGINE_PORT", "8787"))

    uvicorn.run(
        "pdf_editor_document_engine.api.app:create_app",
        factory=True,
        host=host,
        port=port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
