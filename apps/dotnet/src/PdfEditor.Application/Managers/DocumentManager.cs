using System.Security.Cryptography;
using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Contracts.Common;
using PdfEditor.Contracts.Documents;
using PdfEditor.Domain.Entities;
using PdfEditor.Domain.Enums;

namespace PdfEditor.Application.Managers;

public sealed class DocumentManager
{
    private readonly IDocumentRepository documentRepository;
    private readonly IDocumentVersionRepository documentVersionRepository;
    private readonly IDocumentJobRepository documentJobRepository;
    private readonly IAuditLogRepository auditLogRepository;
    private readonly IFileStorageService fileStorageService;
    private readonly IUserContextAccessor userContextAccessor;
    private readonly IClock clock;

    public DocumentManager(
        IDocumentRepository documentRepository,
        IDocumentVersionRepository documentVersionRepository,
        IDocumentJobRepository documentJobRepository,
        IAuditLogRepository auditLogRepository,
        IFileStorageService fileStorageService,
        IUserContextAccessor userContextAccessor,
        IClock clock)
    {
        this.documentRepository = documentRepository;
        this.documentVersionRepository = documentVersionRepository;
        this.documentJobRepository = documentJobRepository;
        this.auditLogRepository = auditLogRepository;
        this.fileStorageService = fileStorageService;
        this.userContextAccessor = userContextAccessor;
        this.clock = clock;
    }

    public async Task<DocumentSummaryDto> UploadAsync(CreateDocumentRequest request, string originalFileName, Stream fileStream, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document upload manager request received",
            action: "Create",
            result: "Started",
            updatedBy: string.Empty,
            description: $"OriginalFileName={originalFileName}, Title={request.Title}");

        if (fileStream.Length == 0)
        {
            throw new InvalidOperationException("Choose a PDF file to continue.");
        }

        if (!originalFileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Only PDF files are supported.");
        }

        var userId = userContextAccessor.GetRequiredUserId();
        var utcNow = clock.UtcNow;
        var storagePath = await fileStorageService.SaveFileAsync(fileStream, "originals", originalFileName, cancellationToken);
        var documentTitle = string.IsNullOrWhiteSpace(request.Title)
            ? Path.GetFileNameWithoutExtension(originalFileName)
            : request.Title.Trim();

        fileStream.Position = 0;
        using var sha = SHA256.Create();
        var checksum = Convert.ToHexString(await sha.ComputeHashAsync(fileStream, cancellationToken));

        var document = new Document
        {
            DocumentId = Guid.NewGuid(),
            Title = documentTitle,
            Description = request.Description?.Trim(),
            OriginalFileName = originalFileName,
            StoredFileName = Path.GetFileName(storagePath),
            StoragePath = storagePath,
            FileSizeInBytes = fileStream.Length,
            UploadedByUserId = userId,
            ChecksumSha256 = checksum,
            CreatedByUserId = userId,
            UpdatedByUserId = userId,
            CreatedOnUtc = utcNow,
            UpdatedOnUtc = utcNow
        };

        await documentRepository.AddAsync(document, cancellationToken);
        await documentVersionRepository.AddAsync(new DocumentVersion
        {
            DocumentVersionId = Guid.NewGuid(),
            DocumentId = document.DocumentId,
            VersionNumber = 1,
            VersionLabel = "Original Upload",
            VersionStatus = DocumentVersionStatus.Original,
            StoredFileName = document.StoredFileName,
            StoragePath = storagePath,
            FileSizeInBytes = fileStream.Length,
            ChecksumSha256 = checksum,
            IsCurrentVersion = true,
            CreatedByUserId = userId,
            CreatedOnUtc = utcNow
        }, cancellationToken);
        await auditLogRepository.AddAsync(new AuditLog
        {
            AuditLogId = Guid.NewGuid(),
            UserId = userId,
            EventType = "DocumentUploaded",
            EntityName = nameof(Document),
            EntityId = document.DocumentId.ToString(),
            EventDescription = $"Uploaded document '{document.Title}'.",
            CreatedOnUtc = utcNow
        }, cancellationToken);
        await documentRepository.SaveChangesAsync(cancellationToken);

        AppLogger.Info(
            message: "Document upload manager request completed successfully",
            action: "Create",
            result: "Succeeded",
            updatedBy: userId.ToString(),
            description: $"DocumentId={document.DocumentId}, Title={document.Title}");

        return MapDocument(document);
    }

    public async Task<PagedResult<DocumentSummaryDto>> SearchAsync(string? searchTerm, int pageNumber, int pageSize, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document search manager request received",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SearchTerm={searchTerm}, PageNumber={pageNumber}, PageSize={pageSize}");

        var documents = await documentRepository.SearchAsync(searchTerm, pageNumber, pageSize, cancellationToken);
        var totalCount = await documentRepository.CountAsync(searchTerm, cancellationToken);
        var response = new PagedResult<DocumentSummaryDto>
        {
            Items = documents.Select(MapDocument).ToArray(),
            PageNumber = pageNumber,
            PageSize = pageSize,
            TotalCount = totalCount
        };

        AppLogger.Info(
            message: "Document search manager request completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"TotalCount={totalCount}, PageNumber={pageNumber}, PageSize={pageSize}");

        return response;
    }

    public async Task<GetDocumentByIdResponse?> GetByIdAsync(Guid documentId, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document details manager request received",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}");

        var document = await documentRepository.GetByIdAsync(documentId, cancellationToken);
        if (document is null)
        {
            return null;
        }

        var versions = await documentVersionRepository.GetByDocumentIdAsync(documentId, cancellationToken);
        var jobs = await documentJobRepository.GetByDocumentIdAsync(documentId, cancellationToken);

        var response = new GetDocumentByIdResponse
        {
            Document = MapDocument(document),
            Versions = versions.Select(version => new DocumentVersionDto
            {
                DocumentVersionId = version.DocumentVersionId,
                VersionNumber = version.VersionNumber,
                VersionLabel = version.VersionLabel,
                VersionStatus = version.VersionStatus.ToString(),
                IsCurrentVersion = version.IsCurrentVersion,
                FileSizeInBytes = version.FileSizeInBytes,
                CreatedOnUtc = version.CreatedOnUtc
            }).ToArray(),
            Jobs = jobs.Select(job => new CompressionJobDto
            {
                DocumentJobId = job.DocumentJobId,
                JobType = job.JobType.ToString(),
                JobStatus = job.JobStatus.ToString(),
                CompressionProfile = job.CompressionProfile?.ToString(),
                FailureReason = job.FailureReason,
                CreatedOnUtc = job.CreatedOnUtc
            }).ToArray()
        };

        AppLogger.Info(
            message: "Document details manager request completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}, VersionCount={response.Versions.Count}, JobCount={response.Jobs.Count}");

        return response;
    }

    public async Task SoftDeleteAsync(Guid documentId, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document delete manager request received",
            action: "Delete",
            result: "Started",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}");

        var document = await documentRepository.GetTrackedByIdAsync(documentId, cancellationToken)
            ?? throw new KeyNotFoundException("Document not found.");

        document.IsDeleted = true;
        document.UpdatedByUserId = userContextAccessor.GetRequiredUserId();
        document.UpdatedOnUtc = clock.UtcNow;

        await auditLogRepository.AddAsync(new AuditLog
        {
            AuditLogId = Guid.NewGuid(),
            UserId = userContextAccessor.GetRequiredUserId(),
            EventType = "DocumentDeleted",
            EntityName = nameof(Document),
            EntityId = document.DocumentId.ToString(),
            EventDescription = $"Soft-deleted document '{document.Title}'.",
            CreatedOnUtc = clock.UtcNow
        }, cancellationToken);

        await documentRepository.SaveChangesAsync(cancellationToken);

        AppLogger.Info(
            message: "Document delete manager request completed successfully",
            action: "Delete",
            result: "Succeeded",
            updatedBy: document.UpdatedByUserId?.ToString() ?? string.Empty,
            description: $"DocumentId={documentId}, Title={document.Title}");
    }

    public async Task RestoreAsync(Guid documentId, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document restore manager request received",
            action: "Restore",
            result: "Started",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}");

        var document = await documentRepository.GetTrackedByIdAsync(documentId, cancellationToken)
            ?? throw new KeyNotFoundException("Document not found.");

        document.IsDeleted = false;
        document.UpdatedByUserId = userContextAccessor.GetRequiredUserId();
        document.UpdatedOnUtc = clock.UtcNow;

        await auditLogRepository.AddAsync(new AuditLog
        {
            AuditLogId = Guid.NewGuid(),
            UserId = userContextAccessor.GetRequiredUserId(),
            EventType = "DocumentRestored",
            EntityName = nameof(Document),
            EntityId = document.DocumentId.ToString(),
            EventDescription = $"Restored document '{document.Title}'.",
            CreatedOnUtc = clock.UtcNow
        }, cancellationToken);

        await documentRepository.SaveChangesAsync(cancellationToken);

        AppLogger.Info(
            message: "Document restore manager request completed successfully",
            action: "Restore",
            result: "Succeeded",
            updatedBy: document.UpdatedByUserId?.ToString() ?? string.Empty,
            description: $"DocumentId={documentId}, Title={document.Title}");
    }

    public async Task<DocumentDownloadDto> DownloadOriginalAsync(Guid documentId, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document download manager request received",
            action: "Download",
            result: "Started",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}");

        var document = await documentRepository.GetByIdAsync(documentId, cancellationToken)
            ?? throw new KeyNotFoundException("Document not found.");

        var response = new DocumentDownloadDto
        {
            FileName = document.OriginalFileName,
            MimeType = document.MimeType,
            ContentStream = await fileStorageService.ReadFileAsync(document.StoragePath, cancellationToken)
        };

        AppLogger.Info(
            message: "Document download manager request completed successfully",
            action: "Download",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}, FileName={document.OriginalFileName}");

        return response;
    }

    private static DocumentSummaryDto MapDocument(Document document) =>
        new()
        {
            DocumentId = document.DocumentId,
            Title = document.Title,
            OriginalFileName = document.OriginalFileName,
            FileSizeInBytes = document.FileSizeInBytes,
            CurrentVersionNumber = document.CurrentVersionNumber,
            DocumentStatus = document.DocumentStatus.ToString(),
            IsDeleted = document.IsDeleted,
            CreatedOnUtc = document.CreatedOnUtc
        };
}
