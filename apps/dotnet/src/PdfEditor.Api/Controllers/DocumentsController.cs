using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PdfEditor.Application.Managers;
using PdfEditor.Contracts.Documents;

namespace PdfEditor.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/documents")]
public sealed class DocumentsController : ApiControllerBase
{
    private readonly DocumentManager documentManager;
    private readonly DocumentCompressionManager documentCompressionManager;
    private readonly DocumentPageOperationManager documentPageOperationManager;

    public DocumentsController(
        DocumentManager documentManager,
        DocumentCompressionManager documentCompressionManager,
        DocumentPageOperationManager documentPageOperationManager)
    {
        this.documentManager = documentManager;
        this.documentCompressionManager = documentCompressionManager;
        this.documentPageOperationManager = documentPageOperationManager;
    }

    [HttpPost]
    [RequestSizeLimit(25 * 1024 * 1024)]
    public async Task<IActionResult> UploadAsync([FromForm] CreateDocumentRequest request, IFormFile file, CancellationToken cancellationToken)
        => await ExecuteAsync(
            async () =>
            {
                if (file is null)
                {
                    throw new InvalidOperationException("Choose a PDF file to upload.");
                }

                if (file.Length == 0)
                {
                    throw new InvalidOperationException("The uploaded file is empty.");
                }

                if (!file.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException("Only PDF files are allowed.");
                }

                await using var stream = file.OpenReadStream();
                return await documentManager.UploadAsync(request, file.FileName, stream, cancellationToken);
            },
            "Document uploaded successfully.",
            "Create",
            $"FileName={file?.FileName}, Title={request.Title}",
            response => CreatedResponse($"/api/v1/documents/{response.DocumentId}", response, "Document uploaded successfully."));

    [HttpGet]
    public async Task<IActionResult> SearchAsync([FromQuery] string? searchTerm, [FromQuery] int pageNumber = 1, [FromQuery] int pageSize = 20, CancellationToken cancellationToken = default)
        => await ExecuteAsync(
            () => documentManager.SearchAsync(searchTerm, pageNumber, pageSize, cancellationToken),
            "Documents loaded successfully.",
            "View",
            $"SearchTerm={searchTerm}, PageNumber={pageNumber}, PageSize={pageSize}");

    [HttpGet("{documentId:guid}")]
    public async Task<IActionResult> GetByIdAsync(Guid documentId, CancellationToken cancellationToken)
        => await ExecuteAsync(
            async () => await documentManager.GetByIdAsync(documentId, cancellationToken)
                ?? throw new KeyNotFoundException("Document not found."),
            "Document loaded successfully.",
            "View",
            $"DocumentId={documentId}");

    [HttpDelete("{documentId:guid}")]
    public async Task<IActionResult> SoftDelete(Guid documentId, CancellationToken cancellationToken)
        => await ExecuteNoDataAsync(
            () => documentManager.SoftDeleteAsync(documentId, cancellationToken),
            "Document deleted successfully.",
            "Delete",
            $"DocumentId={documentId}");

    [HttpPost("{documentId:guid}/restore")]
    public async Task<IActionResult> Restore(Guid documentId, CancellationToken cancellationToken)
        => await ExecuteNoDataAsync(
            () => documentManager.RestoreAsync(documentId, cancellationToken),
            "Document restored successfully.",
            "Restore",
            $"DocumentId={documentId}");

    [HttpGet("{documentId:guid}/download")]
    public async Task<IActionResult> Download(Guid documentId, CancellationToken cancellationToken)
        => await ExecuteFileAsync(
            () => documentManager.DownloadOriginalAsync(documentId, cancellationToken),
            "Download",
            $"DocumentId={documentId}");

    [HttpGet("{documentId:guid}/versions")]
    public async Task<IActionResult> GetVersionsAsync(Guid documentId, CancellationToken cancellationToken)
        => await ExecuteAsync(
            async () =>
            {
                var response = await documentManager.GetByIdAsync(documentId, cancellationToken)
                    ?? throw new KeyNotFoundException("Document not found.");
                return response.Versions;
            },
            "Document versions loaded successfully.",
            "View",
            $"DocumentId={documentId}");

    [HttpPost("{documentId:guid}/compress")]
    public async Task<IActionResult> CompressAsync(Guid documentId, [FromBody] CompressDocumentRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => documentCompressionManager.QueueCompressionAsync(documentId, request, cancellationToken),
            "Document compression completed successfully.",
            "Update",
            $"DocumentId={documentId}, CompressionProfile={request.CompressionProfile}");

    [HttpPost("{documentId:guid}/rotate-pages")]
    public async Task<IActionResult> RotatePagesAsync(Guid documentId, [FromBody] RotatePagesRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => documentPageOperationManager.RotatePagesAsync(documentId, request, cancellationToken),
            "Pages rotated successfully.",
            "Update",
            $"DocumentId={documentId}, PageCount={request.PageNumbers.Count}, Degrees={request.Degrees}");

    [HttpPost("{documentId:guid}/delete-pages")]
    public async Task<IActionResult> DeletePagesAsync(Guid documentId, [FromBody] DeletePagesRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => documentPageOperationManager.DeletePagesAsync(documentId, request, cancellationToken),
            "Pages deleted successfully.",
            "Delete",
            $"DocumentId={documentId}, PageCount={request.PageNumbers.Count}");

    [HttpPost("{documentId:guid}/reorder-pages")]
    public async Task<IActionResult> ReorderPagesAsync(Guid documentId, [FromBody] ReorderPagesRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => documentPageOperationManager.ReorderPagesAsync(documentId, request, cancellationToken),
            "Pages reordered successfully.",
            "Update",
            $"DocumentId={documentId}, OrderedPageCount={request.OrderedPageNumbers.Count}");
}
