using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PdfEditor.Application.Managers;
using PdfEditor.Application.Models;
using PdfEditor.Contracts.Documents;

namespace PdfEditor.Api.Controllers;

[ApiController]
[Route("api/v1/tool-sessions")]
public sealed class ToolSessionsController : ApiControllerBase
{
    private readonly ToolSessionManager toolSessionManager;

    public ToolSessionsController(ToolSessionManager toolSessionManager)
    {
        this.toolSessionManager = toolSessionManager;
    }

    [HttpPost]
    [AllowAnonymous]
    [RequestSizeLimit(25 * 1024 * 1024)]
    public async Task<IActionResult> CreateAsync([FromForm] CreateToolSessionRequest request, IFormFile file, CancellationToken cancellationToken)
        => await ExecuteAsync(
            async () =>
            {
                if (file is null)
                {
                    throw new InvalidOperationException("Choose a PDF file to upload.");
                }

                await using var stream = file.OpenReadStream();
                return await toolSessionManager.CreateAsync(request, file.FileName, stream, cancellationToken);
            },
            "Tool session created successfully.",
            "Create",
            $"FileName={file?.FileName}, Title={request.Title}",
            response => CreatedResponse($"/api/v1/tool-sessions/{response.ToolSessionId}", response, "Tool session created successfully."));

    [HttpPost("merge")]
    [AllowAnonymous]
    [RequestSizeLimit(100 * 1024 * 1024)]
    public async Task<IActionResult> CreateMergedAsync([FromForm] CreateMergeToolSessionRequest request, [FromForm] List<IFormFile> files, CancellationToken cancellationToken)
        => await ExecuteAsync(
            async () =>
            {
                if (files.Count < 2)
                {
                    throw new InvalidOperationException("Choose at least two PDF files to merge.");
                }

                var uploadedFiles = new List<ToolSessionUploadFile>();

                foreach (var file in files)
                {
                    uploadedFiles.Add(new ToolSessionUploadFile
                    {
                        OriginalFileName = file.FileName,
                        FileStream = file.OpenReadStream()
                    });
                }

                try
                {
                    return await toolSessionManager.CreateMergedAsync(request, uploadedFiles, cancellationToken);
                }
                finally
                {
                    foreach (var uploadedFile in uploadedFiles)
                    {
                        await uploadedFile.FileStream.DisposeAsync();
                    }
                }
            },
            "Merged tool session created successfully.",
            "Create",
            $"FileCount={files.Count}, Title={request.Title}",
            response => CreatedResponse($"/api/v1/tool-sessions/{response.ToolSessionId}", response, "Merged tool session created successfully."));

    [HttpGet("{toolSessionId:guid}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetAsync(Guid toolSessionId, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.GetAsync(toolSessionId, cancellationToken),
            "Tool session loaded successfully.",
            "View",
            $"ToolSessionId={toolSessionId}");

    [HttpGet("{toolSessionId:guid}/file")]
    [AllowAnonymous]
    public async Task<IActionResult> DownloadAsync(Guid toolSessionId, [FromQuery] bool download, CancellationToken cancellationToken)
        => await ExecuteFileAsync(
            () => toolSessionManager.DownloadAsync(toolSessionId, download, cancellationToken),
            "Download",
            $"ToolSessionId={toolSessionId}, Download={download}",
            download,
            enableRangeProcessing: !download);

    [HttpGet("{toolSessionId:guid}/split-files/{toolSessionSplitArtifactId:guid}")]
    [AllowAnonymous]
    public async Task<IActionResult> DownloadSplitArtifactAsync(Guid toolSessionId, Guid toolSessionSplitArtifactId, CancellationToken cancellationToken)
        => await ExecuteFileAsync(
            () => toolSessionManager.DownloadSplitArtifactAsync(toolSessionId, toolSessionSplitArtifactId, cancellationToken),
            "Download",
            $"ToolSessionId={toolSessionId}, ToolSessionSplitArtifactId={toolSessionSplitArtifactId}");

    [HttpPost("{toolSessionId:guid}/compress")]
    [AllowAnonymous]
    public async Task<IActionResult> CompressAsync(Guid toolSessionId, [FromBody] CompressDocumentRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.CompressAsync(toolSessionId, request, cancellationToken),
            "PDF compressed successfully.",
            "Update",
            $"ToolSessionId={toolSessionId}, CompressionProfile={request.CompressionProfile}");

    [HttpPost("{toolSessionId:guid}/attachments")]
    [AllowAnonymous]
    [RequestSizeLimit(25 * 1024 * 1024)]
    public async Task<IActionResult> AddAttachmentAsync(Guid toolSessionId, IFormFile file, CancellationToken cancellationToken)
        => await ExecuteAsync(
            async () =>
            {
                if (file is null)
                {
                    throw new InvalidOperationException("Choose a file before adding a document attachment.");
                }

                await using var stream = file.OpenReadStream();
                return await toolSessionManager.AddAttachmentAsync(toolSessionId, file.FileName, file.ContentType, stream, cancellationToken);
            },
            "Document attachment added successfully.",
            "Create",
            $"ToolSessionId={toolSessionId}, FileName={file?.FileName}");

    [HttpGet("{toolSessionId:guid}/attachments/{toolSessionAttachmentId:guid}")]
    [AllowAnonymous]
    public async Task<IActionResult> DownloadAttachmentAsync(Guid toolSessionId, Guid toolSessionAttachmentId, CancellationToken cancellationToken)
        => await ExecuteFileAsync(
            () => toolSessionManager.DownloadAttachmentAsync(toolSessionId, toolSessionAttachmentId, cancellationToken),
            "Download",
            $"ToolSessionId={toolSessionId}, ToolSessionAttachmentId={toolSessionAttachmentId}");

    [HttpDelete("{toolSessionId:guid}/attachments/{toolSessionAttachmentId:guid}")]
    [AllowAnonymous]
    public async Task<IActionResult> RemoveAttachmentAsync(Guid toolSessionId, Guid toolSessionAttachmentId, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.RemoveAttachmentAsync(toolSessionId, toolSessionAttachmentId, cancellationToken),
            "Document attachment removed successfully.",
            "Delete",
            $"ToolSessionId={toolSessionId}, ToolSessionAttachmentId={toolSessionAttachmentId}");

    [HttpPost("{toolSessionId:guid}/rotate-pages")]
    [AllowAnonymous]
    public async Task<IActionResult> RotatePagesAsync(Guid toolSessionId, [FromBody] RotatePagesRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.RotatePagesAsync(toolSessionId, request, cancellationToken),
            "Pages rotated successfully.",
            "Update",
            $"ToolSessionId={toolSessionId}, PageCount={request.PageNumbers.Count}, Degrees={request.Degrees}");

    [HttpPost("{toolSessionId:guid}/delete-pages")]
    [AllowAnonymous]
    public async Task<IActionResult> DeletePagesAsync(Guid toolSessionId, [FromBody] DeletePagesRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.DeletePagesAsync(toolSessionId, request, cancellationToken),
            "Pages deleted successfully.",
            "Delete",
            $"ToolSessionId={toolSessionId}, PageCount={request.PageNumbers.Count}");

    [HttpPost("{toolSessionId:guid}/reorder-pages")]
    [AllowAnonymous]
    public async Task<IActionResult> ReorderPagesAsync(Guid toolSessionId, [FromBody] ReorderPagesRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.ReorderPagesAsync(toolSessionId, request, cancellationToken),
            "Pages reordered successfully.",
            "Update",
            $"ToolSessionId={toolSessionId}, OrderedPageCount={request.OrderedPageNumbers.Count}");

    [HttpPut("{toolSessionId:guid}/annotations")]
    [AllowAnonymous]
    public async Task<IActionResult> SaveAnnotationsAsync(Guid toolSessionId, [FromBody] SaveToolSessionAnnotationsRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.SaveAnnotationsAsync(toolSessionId, request, cancellationToken),
            "Annotation state saved successfully.",
            "Update",
            $"ToolSessionId={toolSessionId}, AnnotationCount={request.Annotations.Count}");

    [HttpGet("{toolSessionId:guid}/detected-text")]
    [AllowAnonymous]
    public async Task<IActionResult> GetDetectedTextAsync(Guid toolSessionId, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.GetDetectedTextAsync(toolSessionId, cancellationToken),
            "Detected PDF text loaded successfully.",
            "View",
            $"ToolSessionId={toolSessionId}");

    [HttpGet("{toolSessionId:guid}/document-snapshot")]
    [AllowAnonymous]
    public async Task<IActionResult> GetDocumentSnapshotAsync(Guid toolSessionId, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.GetDocumentSnapshotAsync(toolSessionId, cancellationToken),
            "PDF editor snapshot loaded successfully.",
            "View",
            $"ToolSessionId={toolSessionId}");

    [HttpGet("{toolSessionId:guid}/font-resource")]
    [AllowAnonymous]
    public async Task<IActionResult> GetFontResourceAsync(Guid toolSessionId, [FromQuery] GetToolSessionFontResourceRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.GetFontResourceAsync(toolSessionId, request, cancellationToken),
            "PDF editor font resource loaded successfully.",
            "View",
            $"ToolSessionId={toolSessionId}, TextObjectId={request.TextObjectId}, TextBlockId={request.TextBlockId}, FontName={request.FontName}");

    [HttpPost("{toolSessionId:guid}/ocr")]
    [AllowAnonymous]
    public async Task<IActionResult> RunOcrAsync(Guid toolSessionId, [FromBody] RunToolSessionOcrRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.RunOcrAsync(toolSessionId, request, cancellationToken),
            "OCR completed successfully.",
            "Update",
            $"ToolSessionId={toolSessionId}, LanguageCode={request.LanguageCode}, PageRange={request.PageRange}, Deskew={request.Deskew}, ForceOcr={request.ForceOcr}");

    [HttpPost("{toolSessionId:guid}/replace-text")]
    [AllowAnonymous]
    public async Task<IActionResult> ReplaceTextAsync(Guid toolSessionId, [FromBody] ReplaceToolSessionTextRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.ReplaceTextAsync(toolSessionId, request, cancellationToken),
            "PDF text updated successfully.",
            "Update",
            $"ToolSessionId={toolSessionId}, TextBlockId={request.TextBlockId}");

    [HttpPost("{toolSessionId:guid}/update-text-layout")]
    [AllowAnonymous]
    public async Task<IActionResult> UpdateTextLayoutAsync(Guid toolSessionId, [FromBody] UpdateToolSessionTextLayoutRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.UpdateTextLayoutAsync(toolSessionId, request, cancellationToken),
            request.KeepOriginal ? "PDF text duplicated successfully." : "PDF text moved successfully.",
            "Update",
            $"ToolSessionId={toolSessionId}, TextBlockId={request.TextBlockId}, KeepOriginal={request.KeepOriginal}");

    [HttpPost("{toolSessionId:guid}/undo-text")]
    [AllowAnonymous]
    public async Task<IActionResult> UndoTextOperationAsync(Guid toolSessionId, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.UndoTextOperationAsync(toolSessionId, cancellationToken),
            "PDF text edit undone successfully.",
            "Update",
            $"ToolSessionId={toolSessionId}");

    [HttpPost("{toolSessionId:guid}/unlock")]
    [Authorize]
    public async Task<IActionResult> UnlockAsync(Guid toolSessionId, [FromBody] UnlockToolSessionRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.UnlockAsync(toolSessionId, request, cancellationToken),
            "PDF unlocked successfully.",
            "Update",
            $"ToolSessionId={toolSessionId}");

    [HttpPost("{toolSessionId:guid}/split")]
    [AllowAnonymous]
    public async Task<IActionResult> SplitAsync(Guid toolSessionId, [FromBody] SplitToolSessionRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.SplitAsync(toolSessionId, request, cancellationToken),
            "PDF split successfully.",
            "Create",
            $"ToolSessionId={toolSessionId}, RangeCount={request.PageRanges.Count}");

    [HttpPost("{toolSessionId:guid}/save")]
    [Authorize]
    public async Task<IActionResult> SaveAsync(Guid toolSessionId, [FromBody] SaveToolSessionRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => toolSessionManager.SaveAsync(toolSessionId, request, cancellationToken),
            "Tool session saved successfully.",
            "Create",
            $"ToolSessionId={toolSessionId}, Title={request.Title}");
}
