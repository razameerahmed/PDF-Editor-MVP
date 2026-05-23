using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace PdfEditor.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1")]
public sealed class DocumentJobsController : ApiControllerBase
{
    [HttpGet("document-jobs/{documentJobId:guid}")]
    public async Task<IActionResult> GetJobById(Guid documentJobId)
        => await ExecuteAsync(
            () => Task.FromResult<object?>(new { documentJobId, status = "Pending" }),
            "Document job loaded successfully.",
            "View",
            $"DocumentJobId={documentJobId}");

    [HttpGet("documents/{documentId:guid}/jobs")]
    public async Task<IActionResult> GetByDocumentId(Guid documentId)
        => await ExecuteAsync(
            () => Task.FromResult(Array.Empty<object>()),
            "Document jobs loaded successfully.",
            "View",
            $"DocumentId={documentId}");
}
