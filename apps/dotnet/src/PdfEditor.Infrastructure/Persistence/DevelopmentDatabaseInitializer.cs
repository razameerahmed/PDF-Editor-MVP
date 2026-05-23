using System.Text;
using BCrypt.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PdfEditor.Domain.Entities;
using PdfEditor.Domain.Enums;
using PdfEditor.Infrastructure.Configuration;

namespace PdfEditor.Infrastructure.Persistence;

public sealed class DevelopmentDatabaseInitializer
{
    private readonly PdfEditorDbContext dbContext;
    private readonly ILogger<DevelopmentDatabaseInitializer> logger;
    private readonly StorageOptions storageOptions;

    public DevelopmentDatabaseInitializer(
        PdfEditorDbContext dbContext,
        ILogger<DevelopmentDatabaseInitializer> logger,
        Microsoft.Extensions.Options.IOptions<StorageOptions> storageOptions)
    {
        this.dbContext = dbContext;
        this.logger = logger;
        this.storageOptions = storageOptions.Value;
    }

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        await dbContext.Database.EnsureCreatedAsync(cancellationToken);

        var ownerUser = await EnsureSeedUserAsync(
            Guid.Parse("11111111-1111-1111-1111-111111111111"),
            "Olivia",
            "Owner",
            "owner@pdfeditor.local",
            UserRole.Owner,
            SubscriptionTier.Paid,
            cancellationToken);

        var editorUser = await EnsureSeedUserAsync(
            Guid.Parse("22222222-2222-2222-2222-222222222222"),
            "Ethan",
            "Editor",
            "editor@pdfeditor.local",
            UserRole.Editor,
            SubscriptionTier.Paid,
            cancellationToken);

        await EnsureSeedUserAsync(
            Guid.Parse("33333333-3333-3333-3333-333333333333"),
            "Vera",
            "Viewer",
            "viewer@pdfeditor.local",
            UserRole.Viewer,
            SubscriptionTier.Free,
            cancellationToken);

        if (await dbContext.Documents.AnyAsync(cancellationToken))
        {
            return;
        }

        Directory.CreateDirectory(Path.GetFullPath(storageOptions.RootPath));
        Directory.CreateDirectory(Path.Combine(Path.GetFullPath(storageOptions.RootPath), storageOptions.OriginalsPath));
        Directory.CreateDirectory(Path.Combine(Path.GetFullPath(storageOptions.RootPath), storageOptions.VersionsPath));

        var seededDocument = await CreateSeedDocumentAsync(ownerUser.UserId, cancellationToken);
        var failedJob = new DocumentJob
        {
            DocumentJobId = Guid.NewGuid(),
            DocumentId = seededDocument.DocumentId,
            SourceDocumentVersionId = seededDocument.Versions.First().DocumentVersionId,
            JobType = DocumentJobType.Compression,
            JobStatus = DocumentJobStatus.Failed,
            RequestedByUserId = editorUser.UserId,
            CompressionProfile = CompressionProfile.MaximumCompression,
            StartedOnUtc = DateTime.UtcNow.AddMinutes(-20),
            CompletedOnUtc = DateTime.UtcNow.AddMinutes(-19),
            FailureReason = "qpdf executable was not available.",
            MetadataJson = "{\"requestedFrom\":\"seed\"}",
            CreatedOnUtc = DateTime.UtcNow.AddMinutes(-20)
        };

        var completedJob = new DocumentJob
        {
            DocumentJobId = Guid.NewGuid(),
            DocumentId = seededDocument.DocumentId,
            SourceDocumentVersionId = seededDocument.Versions.First().DocumentVersionId,
            JobType = DocumentJobType.Compression,
            JobStatus = DocumentJobStatus.Succeeded,
            RequestedByUserId = ownerUser.UserId,
            CompressionProfile = CompressionProfile.Balanced,
            StartedOnUtc = DateTime.UtcNow.AddHours(-2),
            CompletedOnUtc = DateTime.UtcNow.AddHours(-2).AddSeconds(8),
            MetadataJson = "{\"originalSizeInBytes\":698,\"compressedSizeInBytes\":612}",
            CreatedOnUtc = DateTime.UtcNow.AddHours(-2)
        };

        var annotation = new DocumentAnnotation
        {
            DocumentAnnotationId = Guid.NewGuid(),
            DocumentId = seededDocument.DocumentId,
            DocumentVersionId = seededDocument.Versions.First().DocumentVersionId,
            AnnotationType = "Text",
            PageNumber = 1,
            AnnotationPayloadJson = "{\"text\":\"Review this paragraph\",\"x\":120,\"y\":220}",
            CreatedByUserId = ownerUser.UserId,
            UpdatedByUserId = ownerUser.UserId,
            CreatedOnUtc = DateTime.UtcNow.AddMinutes(-45),
            UpdatedOnUtc = DateTime.UtcNow.AddMinutes(-30)
        };

        dbContext.Documents.Add(seededDocument);
        dbContext.DocumentVersions.AddRange(seededDocument.Versions);
        dbContext.DocumentJobs.AddRange(completedJob, failedJob);
        dbContext.DocumentAnnotations.Add(annotation);
        dbContext.AuditLogs.AddRange(
            new AuditLog
            {
                AuditLogId = Guid.NewGuid(),
                UserId = ownerUser.UserId,
                EventType = "UserLogin",
                EntityName = nameof(User),
                EntityId = ownerUser.UserId.ToString(),
                EventDescription = "Seeded owner login event.",
                CreatedOnUtc = DateTime.UtcNow.AddHours(-3)
            },
            new AuditLog
            {
                AuditLogId = Guid.NewGuid(),
                UserId = ownerUser.UserId,
                EventType = "DocumentUploaded",
                EntityName = nameof(Document),
                EntityId = seededDocument.DocumentId.ToString(),
                EventDescription = $"Seeded sample document '{seededDocument.Title}'.",
                CreatedOnUtc = DateTime.UtcNow.AddHours(-3)
            });

        await dbContext.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Development database initialized with seeded users and sample documents.");
    }

    private async Task<User> EnsureSeedUserAsync(
        Guid userId,
        string firstName,
        string lastName,
        string emailAddress,
        UserRole role,
        SubscriptionTier subscriptionTier,
        CancellationToken cancellationToken)
    {
        var existingUser = await dbContext.Users.FirstOrDefaultAsync(
            user => user.UserId == userId || user.EmailAddress == emailAddress,
            cancellationToken);

        if (existingUser is null)
        {
            var createdUser = CreateUser(userId, firstName, lastName, emailAddress, role, subscriptionTier);
            dbContext.Users.Add(createdUser);
            await dbContext.SaveChangesAsync(cancellationToken);
            return createdUser;
        }

        existingUser.FirstName = firstName;
        existingUser.LastName = lastName;
        existingUser.EmailAddress = emailAddress;
        existingUser.Role = role;
        existingUser.SubscriptionTier = subscriptionTier;
        existingUser.IsActive = true;
        existingUser.PasswordHash = BCrypt.Net.BCrypt.HashPassword("Password123!");
        existingUser.UpdatedOnUtc = DateTime.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        return existingUser;
    }

    private static User CreateUser(Guid userId, string firstName, string lastName, string emailAddress, UserRole role, SubscriptionTier subscriptionTier)
    {
        var utcNow = DateTime.UtcNow;
        return new User
        {
            UserId = userId,
            FirstName = firstName,
            LastName = lastName,
            EmailAddress = emailAddress,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Password123!"),
            Role = role,
            SubscriptionTier = subscriptionTier,
            IsActive = true,
            CreatedOnUtc = utcNow,
            UpdatedOnUtc = utcNow
        };
    }

    private async Task<Document> CreateSeedDocumentAsync(Guid ownerUserId, CancellationToken cancellationToken)
    {
        var utcNow = DateTime.UtcNow.AddHours(-3);
        var documentId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        var fileName = $"sample-{documentId:N}.pdf";
        var storagePath = Path.Combine(Path.GetFullPath(storageOptions.RootPath), storageOptions.OriginalsPath, fileName);

        if (!File.Exists(storagePath))
        {
            await File.WriteAllBytesAsync(storagePath, BuildMinimalPdf("Quarterly Operations Report"), cancellationToken);
        }

        var fileInfo = new FileInfo(storagePath);
        var version = new DocumentVersion
        {
            DocumentVersionId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            DocumentId = documentId,
            VersionNumber = 1,
            VersionLabel = "Original Upload",
            VersionStatus = DocumentVersionStatus.Original,
            StoredFileName = fileInfo.Name,
            StoragePath = storagePath,
            FileSizeInBytes = fileInfo.Length,
            ChecksumSha256 = "SEED-CHECKSUM-001",
            IsCurrentVersion = true,
            CreatedByUserId = ownerUserId,
            CreatedOnUtc = utcNow
        };

        return new Document
        {
            DocumentId = documentId,
            OriginalFileName = "quarterly-operations-report.pdf",
            StoredFileName = fileInfo.Name,
            FileExtension = ".pdf",
            MimeType = "application/pdf",
            FileSizeInBytes = fileInfo.Length,
            CurrentVersionNumber = 1,
            DocumentStatus = DocumentStatus.Active,
            Title = "Quarterly Operations Report",
            Description = "Seeded sample document for login, viewing, compression, and annotation workflows.",
            UploadedByUserId = ownerUserId,
            StorageProvider = "Local",
            StoragePath = storagePath,
            ChecksumSha256 = "SEED-CHECKSUM-001",
            CreatedOnUtc = utcNow,
            UpdatedOnUtc = utcNow,
            Versions = [version]
        };
    }

    private static byte[] BuildMinimalPdf(string title)
    {
        var pdf = $"""
%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 74 >>
stream
BT
/F1 18 Tf
72 720 Td
({title}) Tj
0 -30 Td
(Seeded sample PDF for PdfEditor MVP.) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000063 00000 n 
0000000122 00000 n 
0000000248 00000 n 
0000000373 00000 n 
trailer
<< /Root 1 0 R /Size 6 >>
startxref
443
%%EOF
""";

        return Encoding.ASCII.GetBytes(pdf);
    }
}
