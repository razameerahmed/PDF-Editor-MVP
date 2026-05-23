using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Contracts.Documents;
using PdfEditor.Domain.Entities;
using PdfEditor.Domain.Enums;
using System.Security.Cryptography;

namespace PdfEditor.Application.Managers;

public sealed class DocumentCompressionManager
{
    private readonly IDocumentRepository documentRepository;
    private readonly IDocumentVersionRepository documentVersionRepository;
    private readonly IDocumentJobRepository documentJobRepository;
    private readonly IAuditLogRepository auditLogRepository;
    private readonly IPdfCompressionService pdfCompressionService;
    private readonly IFileStorageService fileStorageService;
    private readonly IUserContextAccessor userContextAccessor;
    private readonly IClock clock;

    public DocumentCompressionManager(
        IDocumentRepository documentRepository,
        IDocumentVersionRepository documentVersionRepository,
        IDocumentJobRepository documentJobRepository,
        IAuditLogRepository auditLogRepository,
        IPdfCompressionService pdfCompressionService,
        IFileStorageService fileStorageService,
        IUserContextAccessor userContextAccessor,
        IClock clock)
    {
        this.documentRepository = documentRepository;
        this.documentVersionRepository = documentVersionRepository;
        this.documentJobRepository = documentJobRepository;
        this.auditLogRepository = auditLogRepository;
        this.pdfCompressionService = pdfCompressionService;
        this.fileStorageService = fileStorageService;
        this.userContextAccessor = userContextAccessor;
        this.clock = clock;
    }

    public async Task<CompressDocumentResponse> QueueCompressionAsync(Guid documentId, CompressDocumentRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document compression manager request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"DocumentId={documentId}, CompressionProfile={request.CompressionProfile}");

        if (!Enum.TryParse<CompressionProfile>(request.CompressionProfile, true, out var compressionProfile))
        {
            throw new InvalidOperationException("Unsupported compression profile.");
        }

        var userId = userContextAccessor.GetRequiredUserId();
        var document = await documentRepository.GetTrackedByIdAsync(documentId, cancellationToken)
            ?? throw new KeyNotFoundException("Document not found.");
        var versions = await documentVersionRepository.GetTrackedByDocumentIdAsync(documentId, cancellationToken);
        var currentVersion = versions.FirstOrDefault(version => version.IsCurrentVersion)
            ?? throw new InvalidOperationException("Current document version was not found.");
        var utcNow = clock.UtcNow;

        var job = new DocumentJob
        {
            DocumentJobId = Guid.NewGuid(),
            DocumentId = documentId,
            SourceDocumentVersionId = currentVersion.DocumentVersionId,
            JobType = DocumentJobType.Compression,
            JobStatus = DocumentJobStatus.Running,
            RequestedByUserId = userId,
            CompressionProfile = compressionProfile,
            StartedOnUtc = utcNow,
            CreatedOnUtc = utcNow
        };

        await documentJobRepository.AddAsync(job, cancellationToken);
        await auditLogRepository.AddAsync(new AuditLog
        {
            AuditLogId = Guid.NewGuid(),
            UserId = userId,
            EventType = "CompressionStarted",
            EntityName = nameof(DocumentJob),
            EntityId = job.DocumentJobId.ToString(),
            EventDescription = "Compression job queued.",
            CreatedOnUtc = utcNow
        }, cancellationToken);

        try
        {
            var outputPath = await fileStorageService.CreateWritableFilePathAsync("versions", currentVersion.StoredFileName, cancellationToken);
            var compressionResult = await pdfCompressionService.CompressAsync(currentVersion.StoragePath, outputPath, compressionProfile.ToString(), cancellationToken);
            await using var outputStream = await fileStorageService.ReadFileAsync(outputPath, cancellationToken);
            using var sha256 = SHA256.Create();
            var checksum = Convert.ToHexString(await sha256.ComputeHashAsync(outputStream, cancellationToken));

            foreach (var version in versions.Where(version => version.IsCurrentVersion))
            {
                version.IsCurrentVersion = false;
                version.VersionStatus = DocumentVersionStatus.Superseded;
            }

            var documentVersion = new DocumentVersion
            {
                DocumentVersionId = Guid.NewGuid(),
                DocumentId = documentId,
                VersionNumber = document.CurrentVersionNumber + 1,
                VersionLabel = $"{compressionProfile} Compression",
                VersionStatus = DocumentVersionStatus.Current,
                StoredFileName = Path.GetFileName(outputPath),
                StoragePath = outputPath,
                FileSizeInBytes = compressionResult.CompressedSizeInBytes,
                ChecksumSha256 = checksum,
                SourceJobId = job.DocumentJobId,
                ChangeSummary = $"Compressed using the {compressionProfile} profile.",
                IsCurrentVersion = true,
                CreatedByUserId = userId,
                CreatedOnUtc = clock.UtcNow
            };

            job.OutputDocumentVersionId = documentVersion.DocumentVersionId;
            job.JobStatus = DocumentJobStatus.Succeeded;
            job.CompletedOnUtc = clock.UtcNow;
            job.MetadataJson = $$"""
                {
                  "originalSizeInBytes": {{compressionResult.OriginalSizeInBytes}},
                  "compressedSizeInBytes": {{compressionResult.CompressedSizeInBytes}},
                  "compressionRatio": {{compressionResult.CompressionRatio}},
                  "durationMilliseconds": {{compressionResult.Duration.TotalMilliseconds}}
                }
                """;

            document.CurrentVersionNumber = documentVersion.VersionNumber;
            document.StoredFileName = documentVersion.StoredFileName;
            document.StoragePath = documentVersion.StoragePath;
            document.FileSizeInBytes = documentVersion.FileSizeInBytes;
            document.ChecksumSha256 = checksum;
            document.UpdatedByUserId = userId;
            document.UpdatedOnUtc = clock.UtcNow;

            await documentVersionRepository.AddAsync(documentVersion, cancellationToken);
            await auditLogRepository.AddAsync(new AuditLog
            {
                AuditLogId = Guid.NewGuid(),
                UserId = userId,
                EventType = "CompressionCompleted",
                EntityName = nameof(DocumentVersion),
                EntityId = documentVersion.DocumentVersionId.ToString(),
                EventDescription = $"Compression completed with the {compressionProfile} profile.",
                CreatedOnUtc = clock.UtcNow
            }, cancellationToken);
            await documentRepository.SaveChangesAsync(cancellationToken);

            var response = new CompressDocumentResponse
            {
                DocumentJobId = job.DocumentJobId,
                DocumentVersionId = documentVersion.DocumentVersionId,
                JobStatus = job.JobStatus.ToString(),
                OriginalSizeInBytes = compressionResult.OriginalSizeInBytes,
                CompressedSizeInBytes = compressionResult.CompressedSizeInBytes,
                CompressionRatio = compressionResult.CompressionRatio,
                ProcessingDurationMilliseconds = (long)compressionResult.Duration.TotalMilliseconds
            };

            AppLogger.Info(
                message: "Document compression manager request completed successfully",
                action: "Update",
                result: "Succeeded",
                updatedBy: userId.ToString(),
                description: $"DocumentId={documentId}, DocumentJobId={job.DocumentJobId}, DocumentVersionId={documentVersion.DocumentVersionId}");

            return response;
        }
        catch (Exception exception)
        {
            job.JobStatus = DocumentJobStatus.Failed;
            job.CompletedOnUtc = clock.UtcNow;
            job.FailureReason = exception.Message;

            await auditLogRepository.AddAsync(new AuditLog
            {
                AuditLogId = Guid.NewGuid(),
                UserId = userId,
                EventType = "CompressionFailed",
                EntityName = nameof(DocumentJob),
                EntityId = job.DocumentJobId.ToString(),
                EventDescription = exception.Message,
                CreatedOnUtc = clock.UtcNow
            }, cancellationToken);
            await documentRepository.SaveChangesAsync(cancellationToken);

            AppLogger.Error(
                message: "Document compression manager request failed with unexpected exception",
                action: "Update",
                result: "Failed",
                updatedBy: userId.ToString(),
                description: $"DocumentId={documentId}, DocumentJobId={job.DocumentJobId}, CompressionProfile={request.CompressionProfile}",
                exception: exception);

            throw;
        }
    }
}
