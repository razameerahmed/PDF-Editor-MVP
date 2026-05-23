using System.Security.Cryptography;
using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Contracts.Documents;
using PdfEditor.Domain.Entities;
using PdfEditor.Domain.Enums;

namespace PdfEditor.Application.Managers;

public sealed class DocumentPageOperationManager
{
    private readonly IDocumentRepository documentRepository;
    private readonly IDocumentVersionRepository documentVersionRepository;
    private readonly IDocumentJobRepository documentJobRepository;
    private readonly IAuditLogRepository auditLogRepository;
    private readonly IPdfDocumentProcessingService pdfDocumentProcessingService;
    private readonly IFileStorageService fileStorageService;
    private readonly IUserContextAccessor userContextAccessor;
    private readonly IClock clock;

    public DocumentPageOperationManager(
        IDocumentRepository documentRepository,
        IDocumentVersionRepository documentVersionRepository,
        IDocumentJobRepository documentJobRepository,
        IAuditLogRepository auditLogRepository,
        IPdfDocumentProcessingService pdfDocumentProcessingService,
        IFileStorageService fileStorageService,
        IUserContextAccessor userContextAccessor,
        IClock clock)
    {
        this.documentRepository = documentRepository;
        this.documentVersionRepository = documentVersionRepository;
        this.documentJobRepository = documentJobRepository;
        this.auditLogRepository = auditLogRepository;
        this.pdfDocumentProcessingService = pdfDocumentProcessingService;
        this.fileStorageService = fileStorageService;
        this.userContextAccessor = userContextAccessor;
        this.clock = clock;
    }

    public Task<PageOperationResponse> RotatePagesAsync(Guid documentId, RotatePagesRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document rotate pages manager request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}, PageCount={request.PageNumbers.Count}, Degrees={request.Degrees}");

        if (request.PageNumbers.Count == 0)
        {
            throw new InvalidOperationException("Select at least one page to rotate.");
        }

        if (request.Degrees is not (90 or 180 or 270))
        {
            throw new InvalidOperationException("Rotation must be 90, 180, or 270 degrees.");
        }

        return CreateDerivedVersionAsync(
            documentId,
            "Rotate Pages",
            DocumentJobType.RotatePages,
            $"Rotated {request.PageNumbers.Count} page(s) by {request.Degrees} degrees.",
            (sourcePath, outputPath, token) => pdfDocumentProcessingService.RotatePagesAsync(sourcePath, outputPath, request.PageNumbers, request.Degrees, token),
            cancellationToken);
    }

    public Task<PageOperationResponse> DeletePagesAsync(Guid documentId, DeletePagesRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document delete pages manager request received",
            action: "Delete",
            result: "Started",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}, PageCount={request.PageNumbers.Count}");

        if (request.PageNumbers.Count == 0)
        {
            throw new InvalidOperationException("Select at least one page to delete.");
        }

        return CreateDerivedVersionAsync(
            documentId,
            "Delete Pages",
            DocumentJobType.DeletePages,
            $"Deleted {request.PageNumbers.Count} page(s).",
            (sourcePath, outputPath, token) => pdfDocumentProcessingService.DeletePagesAsync(sourcePath, outputPath, request.PageNumbers, token),
            cancellationToken);
    }

    public Task<PageOperationResponse> ReorderPagesAsync(Guid documentId, ReorderPagesRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document reorder pages manager request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}, OrderedPageCount={request.OrderedPageNumbers.Count}");

        if (request.OrderedPageNumbers.Count == 0)
        {
            throw new InvalidOperationException("Provide a page order to continue.");
        }

        return CreateDerivedVersionAsync(
            documentId,
            "Reorder Pages",
            DocumentJobType.ReorderPages,
            "Reordered document pages.",
            (sourcePath, outputPath, token) => pdfDocumentProcessingService.ReorderPagesAsync(sourcePath, outputPath, request.OrderedPageNumbers, token),
            cancellationToken);
    }

    private async Task<PageOperationResponse> CreateDerivedVersionAsync(
        Guid documentId,
        string operationName,
        DocumentJobType jobType,
        string changeSummary,
        Func<string, string, CancellationToken, Task> operation,
        CancellationToken cancellationToken)
    {
        var userId = userContextAccessor.GetRequiredUserId();
        var document = await documentRepository.GetTrackedByIdAsync(documentId, cancellationToken)
            ?? throw new KeyNotFoundException("Document not found.");

        var versions = await documentVersionRepository.GetTrackedByDocumentIdAsync(documentId, cancellationToken);
        var currentVersion = versions.FirstOrDefault(version => version.IsCurrentVersion)
            ?? throw new InvalidOperationException("Current document version was not found.");

        var outputPath = await fileStorageService.CreateWritableFilePathAsync("versions", currentVersion.StoredFileName, cancellationToken);
        await operation(currentVersion.StoragePath, outputPath, cancellationToken);

        await using var outputStream = await fileStorageService.ReadFileAsync(outputPath, cancellationToken);
        using var sha256 = SHA256.Create();
        var checksum = Convert.ToHexString(await sha256.ComputeHashAsync(outputStream, cancellationToken));
        var fileSize = new FileInfo(outputPath).Length;

        foreach (var version in versions.Where(version => version.IsCurrentVersion))
        {
            version.IsCurrentVersion = false;
            version.VersionStatus = DocumentVersionStatus.Superseded;
        }

        var utcNow = clock.UtcNow;
        var documentJob = new DocumentJob
        {
            DocumentJobId = Guid.NewGuid(),
            DocumentId = documentId,
            SourceDocumentVersionId = currentVersion.DocumentVersionId,
            JobType = jobType,
            JobStatus = DocumentJobStatus.Succeeded,
            RequestedByUserId = userId,
            StartedOnUtc = utcNow,
            CompletedOnUtc = utcNow,
            MetadataJson = $$"""{"operationName":"{{operationName}}"}""",
            CreatedOnUtc = utcNow
        };

        var documentVersion = new DocumentVersion
        {
            DocumentVersionId = Guid.NewGuid(),
            DocumentId = documentId,
            VersionNumber = document.CurrentVersionNumber + 1,
            VersionLabel = operationName,
            VersionStatus = DocumentVersionStatus.Current,
            StoredFileName = Path.GetFileName(outputPath),
            StoragePath = outputPath,
            FileSizeInBytes = fileSize,
            ChecksumSha256 = checksum,
            SourceJobId = documentJob.DocumentJobId,
            ChangeSummary = changeSummary,
            IsCurrentVersion = true,
            CreatedByUserId = userId,
            CreatedOnUtc = utcNow
        };

        document.CurrentVersionNumber = documentVersion.VersionNumber;
        document.StoredFileName = documentVersion.StoredFileName;
        document.StoragePath = documentVersion.StoragePath;
        document.FileSizeInBytes = documentVersion.FileSizeInBytes;
        document.ChecksumSha256 = documentVersion.ChecksumSha256;
        document.UpdatedByUserId = userId;
        document.UpdatedOnUtc = utcNow;

        await documentJobRepository.AddAsync(documentJob, cancellationToken);
        await documentVersionRepository.AddAsync(documentVersion, cancellationToken);
        await auditLogRepository.AddAsync(new AuditLog
        {
            AuditLogId = Guid.NewGuid(),
            UserId = userId,
            EventType = "DocumentVersionCreated",
            EntityName = nameof(DocumentVersion),
            EntityId = documentVersion.DocumentVersionId.ToString(),
            EventDescription = $"{operationName} created a new document version.",
            CreatedOnUtc = utcNow
        }, cancellationToken);
        await documentRepository.SaveChangesAsync(cancellationToken);

        var response = new PageOperationResponse
        {
            DocumentId = documentId,
            DocumentVersionId = documentVersion.DocumentVersionId,
            OperationName = operationName,
            Message = changeSummary
        };

        AppLogger.Info(
            message: "Document page operation manager request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: userId.ToString(),
            description: $"DocumentId={documentId}, OperationName={operationName}, DocumentVersionId={documentVersion.DocumentVersionId}");

        return response;
    }
}
