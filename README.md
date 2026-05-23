# PdfEditor Workspace

PdfEditor is organized so source code, docs, scripts, and runtime artifacts live in predictable top-level folders.

## Layout

- `apps/dotnet`
  .NET solution, API, worker, domain/application/infrastructure projects, and backend tests.
- `apps/web/pdf-editor-web`
  React 19 + TypeScript + Vite frontend source and Playwright E2E tests under `tests/e2e`.
- `apps/python/PdfEditor.PythonTools`
  Python tooling home for OCR, conversion, and translation support metadata.
- `apps/python/PdfEditor.DocumentEngine`
  Dedicated local document-processing service for PDF text extraction and editing.
- `docs/postman`
  Postman collection and API testing notes.
- `scripts`
  Local developer utility scripts such as `run-all.ps1`.
- `runtime`
  Local storage, logs, archives, smoke-test artifacts, and the Python virtual environment.

## Login Credentials

- `owner@pdfeditor.local` / `Password123!`
- `editor@pdfeditor.local` / `Password123!`
- `viewer@pdfeditor.local` / `Password123!`

## How To Run

### One command

From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-all.ps1
```

Or on Windows, just double-click:

```text
Start-PdfEditor-All.cmd
```

To stop everything cleanly, double-click:

```text
Stop-PdfEditor-All.cmd
```

This launches:

- the local document engine at `http://127.0.0.1:8787/`
- the hosted API and built-in UI at `http://localhost:5144/`
- the worker process
- the React dev app at `http://localhost:5173/`

### Manual start

Backend:

```powershell
cd .\apps\dotnet
dotnet restore .\PdfEditor.sln
dotnet run --project .\src\PdfEditor.Api\PdfEditor.Api.csproj
```

Document engine:

```powershell
.\runtime\python\venv\Scripts\python.exe .\apps\python\PdfEditor.DocumentEngine\main.py
```

Worker:

```powershell
cd .\apps\dotnet
$env:ConnectionStrings__SqlServer="Server=localhost,1433;Database=PdfEditorMvp;User Id=sa;Password=admin;TrustServerCertificate=true"
dotnet run --project .\src\PdfEditor.Worker\PdfEditor.Worker.csproj
```

Frontend:

```powershell
cd .\apps\web\pdf-editor-web
npm install
npm run dev
```

### Stop all apps

From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-all.ps1
```

Or use a dry run to see what would be stopped:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-all.ps1 -DryRun
```

## Storage and Runtime Files

- Uploaded PDFs, generated versions, temp files, exports, and thumbnails are stored under `runtime/storage`.
- Archived root logs and smoke-test outputs are stored under `runtime/archive`.
- The Python virtual environment lives under `runtime/python/venv`.
- Project-local `ffmpeg` tooling lives under `runtime/tools/ffmpeg/<version>`.

## Media Inspection Tooling

Install or refresh the repo-managed local `ffmpeg` copy:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-ffmpeg.ps1
```

Inspect a local video and extract representative frames:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\inspect-media.ps1 -InputPath "C:\path\to\video.mp4"
```

By default this writes metadata and extracted frames into `runtime/archive/debug-frames`.

## Database

- Schema script:
  `apps/dotnet/src/PdfEditor.Infrastructure/Persistence/Migrations/0001_InitialCreate.sql`
- Seed guidance:
  `apps/dotnet/src/PdfEditor.Infrastructure/Persistence/SeedData.sql`

The API now validates the SQL connection on startup and uses the configured database connection string.

## API Testing

Import the Postman collection from `docs/postman/PdfEditor.postman_collection.json`.

Recommended order:

1. `Login Owner`
2. Copy the returned `accessToken` into the collection variable
3. Run the document and annotation requests
4. Run compression and other file operations

## Python Tooling

The Python tooling source homes are:

- `apps/python/PdfEditor.PythonTools`
- `apps/python/PdfEditor.DocumentEngine`

The live environment is in `runtime/python/venv` and includes OCR, conversion, and offline translation tooling such as:

- `ocrmypdf`
- `pikepdf`
- `PyMuPDF`
- `pdf2docx`
- `pytesseract`
- `argostranslate`
- `fastapi`
- `uvicorn`
