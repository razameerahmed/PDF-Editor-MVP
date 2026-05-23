from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from pdf_editor_document_engine.api.routes.engine import router as engine_router
from pdf_editor_document_engine.api.routes.health import router as health_router
from pdf_editor_document_engine.api.routes.text import router as text_router

logger = logging.getLogger("pdf_editor_document_engine")


def create_app() -> FastAPI:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    app = FastAPI(
        title="PdfEditor Document Engine",
        version="0.3.0",
    )

    @app.exception_handler(ValueError)
    async def handle_value_error(_: Request, exception: ValueError) -> JSONResponse:
        return JSONResponse(status_code=400, content={"detail": str(exception)})

    @app.exception_handler(FileNotFoundError)
    async def handle_file_not_found(_: Request, exception: FileNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exception)})

    @app.exception_handler(Exception)
    async def handle_unhandled_exception(_: Request, exception: Exception) -> JSONResponse:
        logger.exception("Unhandled document engine exception")
        return JSONResponse(status_code=500, content={"detail": "The document engine could not complete the request."})

    app.include_router(health_router)
    app.include_router(engine_router)
    app.include_router(text_router)

    return app
