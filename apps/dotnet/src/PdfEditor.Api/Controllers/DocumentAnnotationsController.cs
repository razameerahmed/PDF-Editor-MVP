using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PdfEditor.Api.Common;
using PdfEditor.Application.Managers;
using PdfEditor.Contracts.Documents;

namespace PdfEditor.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/documents/{documentId:guid}/annotations")]
public sealed class DocumentAnnotationsController : ApiControllerBase
{
    private readonly DocumentAnnotationManager documentAnnotationManager;

    public DocumentAnnotationsController(DocumentAnnotationManager documentAnnotationManager) => this.documentAnnotationManager = documentAnnotationManager;

    [HttpGet]
    public async Task<IActionResult> GetAsync(Guid documentId, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => documentAnnotationManager.GetByDocumentIdAsync(documentId, cancellationToken),
            "Document annotations loaded successfully.",
            "View",
            $"DocumentId={documentId}");

    [HttpPost]
    public async Task<IActionResult> AddAsync(Guid documentId, [FromBody] AddDocumentAnnotationRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => documentAnnotationManager.AddAsync(documentId, request, cancellationToken),
            "Annotation saved successfully.",
            "Create",
            $"DocumentId={documentId}, AnnotationType={request.AnnotationType}, PageNumber={request.PageNumber}");

    [HttpPut("{documentAnnotationId:guid}")]
    public IActionResult Update(Guid documentId, Guid documentAnnotationId)
        => Accepted(ApiResponseFactory.Success<object?>(
            new { documentId, documentAnnotationId },
            "Annotation update workflow is not implemented yet."));

    [HttpDelete("{documentAnnotationId:guid}")]
    public IActionResult Delete(Guid documentId, Guid documentAnnotationId)
        => Ok(ApiResponseFactory.Success("Annotation delete workflow is not implemented yet."));
}
