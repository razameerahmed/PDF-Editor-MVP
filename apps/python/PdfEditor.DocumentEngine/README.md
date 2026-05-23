# PdfEditor Document Engine

This project is the dedicated document-processing engine for PdfEditor.

It exists so the web application can call a stable local service for deep PDF
operations instead of shelling out to one-off helper scripts for every editing
action.

## Responsibilities

- extract a structured text model from PDF pages
- apply text replacement and layout updates
- provide the future home for OCR, object editing, conversion, and export flows
- expose a stable HTTP API for the .NET API and worker projects

## Run Locally

From the repository root:

```powershell
.\runtime\python\venv\Scripts\python.exe .\apps\python\PdfEditor.DocumentEngine\main.py
```

The default local address is:

`http://127.0.0.1:8787`

## Project Layout

- `main.py`
  local development entrypoint
- `src/pdf_editor_document_engine/api`
  FastAPI app and routes
- `src/pdf_editor_document_engine/models`
  request and response models
- `src/pdf_editor_document_engine/services`
  document-processing services

## Notes

This service is designed to become the long-term document engine boundary for
the product. The web app should orchestrate requests and render the editor UI,
while this engine owns the heavy PDF manipulation logic.
