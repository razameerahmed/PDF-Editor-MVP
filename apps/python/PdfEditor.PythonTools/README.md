# PdfEditor Python Tools

This folder is the source and configuration home for Python-based PDF tooling used by the PdfEditor workspace.

The dedicated service boundary for deep editing now lives in:

`apps/python/PdfEditor.DocumentEngine`

## Purpose

The Python toolchain supports:

- OCR processing
- PDF to DOCX conversion
- document parsing and extraction
- offline translation experiments
- future helper scripts for PDF workflows
- compatibility wrappers that can call into the document engine

## Runtime Environment

The active virtual environment is stored outside the source tree at:

`runtime/python/venv`

Activate it from the repo root with:

```powershell
.\runtime\python\venv\Scripts\Activate.ps1
```

## Dependencies

Pinned Python dependencies are listed in `requirements.txt`.

## Scripts

Place future helper scripts in the `scripts` folder.
