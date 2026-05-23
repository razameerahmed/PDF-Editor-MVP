using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Contracts.Documents;
using PdfEditor.Domain.Entities;

namespace PdfEditor.Application.Managers;

public sealed class DocumentAnnotationManager
{
    private readonly IDocumentAnnotationRepository documentAnnotationRepository;
    private readonly IAuditLogRepository auditLogRepository;
    private readonly IPdfAnnotationService pdfAnnotationService;
    private readonly IUserContextAccessor userContextAccessor;
    private readonly IClock clock;

    public DocumentAnnotationManager(
        IDocumentAnnotationRepository documentAnnotationRepository,
        IAuditLogRepository auditLogRepository,
        IPdfAnnotationService pdfAnnotationService,
        IUserContextAccessor userContextAccessor,
        IClock clock)
    {
        this.documentAnnotationRepository = documentAnnotationRepository;
        this.auditLogRepository = auditLogRepository;
        this.pdfAnnotationService = pdfAnnotationService;
        this.userContextAccessor = userContextAccessor;
        this.clock = clock;
    }

    public async Task<IReadOnlyCollection<DocumentAnnotationDto>> GetByDocumentIdAsync(Guid documentId, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document annotation list manager request received",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}");

        var annotations = await documentAnnotationRepository.GetActiveByDocumentIdAsync(documentId, cancellationToken);
        var response = annotations.Select(Map).ToArray();

        AppLogger.Info(
            message: "Document annotation list manager request completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}, AnnotationCount={response.Length}");

        return response;
    }

    public async Task<DocumentAnnotationDto> AddAsync(Guid documentId, AddDocumentAnnotationRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document annotation save manager request received",
            action: "Create",
            result: "Started",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}, AnnotationType={request.AnnotationType}, PageNumber={request.PageNumber}");

        var userId = userContextAccessor.GetRequiredUserId();
        var normalizedPayload = await pdfAnnotationService.NormalizeAnnotationPayloadAsync(request.AnnotationType, request.AnnotationPayloadJson, cancellationToken);

        var annotation = new DocumentAnnotation
        {
            DocumentAnnotationId = Guid.NewGuid(),
            DocumentId = documentId,
            DocumentVersionId = request.DocumentVersionId,
            AnnotationType = request.AnnotationType,
            PageNumber = request.PageNumber,
            AnnotationPayloadJson = normalizedPayload,
            CreatedByUserId = userId,
            UpdatedByUserId = userId,
            CreatedOnUtc = clock.UtcNow,
            UpdatedOnUtc = clock.UtcNow
        };

        await documentAnnotationRepository.AddAsync(annotation, cancellationToken);
        await auditLogRepository.AddAsync(new AuditLog
        {
            AuditLogId = Guid.NewGuid(),
            UserId = userId,
            EventType = "AnnotationSaved",
            EntityName = nameof(DocumentAnnotation),
            EntityId = annotation.DocumentAnnotationId.ToString(),
            EventDescription = $"Saved {annotation.AnnotationType} annotation.",
            CreatedOnUtc = clock.UtcNow
        }, cancellationToken);

        var response = Map(annotation);

        AppLogger.Info(
            message: "Document annotation save manager request completed successfully",
            action: "Create",
            result: "Succeeded",
            updatedBy: userId.ToString(),
            description: $"DocumentId={documentId}, DocumentAnnotationId={annotation.DocumentAnnotationId}");

        return response;
    }

    private static DocumentAnnotationDto Map(DocumentAnnotation annotation) =>
        new()
        {
            DocumentAnnotationId = annotation.DocumentAnnotationId,
            DocumentVersionId = annotation.DocumentVersionId,
            AnnotationType = annotation.AnnotationType,
            PageNumber = annotation.PageNumber,
            AnnotationPayloadJson = annotation.AnnotationPayloadJson,
            UpdatedOnUtc = annotation.UpdatedOnUtc
        };
}
