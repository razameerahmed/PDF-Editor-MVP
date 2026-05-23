using FluentAssertions;
using NSubstitute;
using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Application.Managers;
using PdfEditor.Contracts.Documents;
using PdfEditor.Domain.Entities;
using PdfEditor.Domain.Enums;

namespace PdfEditor.Application.Tests;

public sealed class DocumentCompressionManagerTests
{
    [Fact]
    public async Task QueueCompressionAsync_ShouldCreateCompletedCompressionVersion()
    {
        var documentRepository = Substitute.For<IDocumentRepository>();
        var documentVersionRepository = Substitute.For<IDocumentVersionRepository>();
        var documentJobRepository = Substitute.For<IDocumentJobRepository>();
        var auditLogRepository = Substitute.For<IAuditLogRepository>();
        var pdfCompressionService = Substitute.For<IPdfCompressionService>();
        var fileStorageService = Substitute.For<IFileStorageService>();
        var userContextAccessor = Substitute.For<IUserContextAccessor>();
        var clock = Substitute.For<IClock>();

        var documentId = Guid.NewGuid();
        var currentVersionId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var utcNow = DateTime.UtcNow;

        documentRepository.GetTrackedByIdAsync(documentId, Arg.Any<CancellationToken>())
            .Returns(new Document
            {
                DocumentId = documentId,
                Title = "Sample",
                CurrentVersionNumber = 1
            });

        documentVersionRepository.GetTrackedByDocumentIdAsync(documentId, Arg.Any<CancellationToken>())
            .Returns(
            [
                new DocumentVersion
                {
                    DocumentVersionId = currentVersionId,
                    DocumentId = documentId,
                    VersionNumber = 1,
                    VersionLabel = "Original Upload",
                    VersionStatus = DocumentVersionStatus.Original,
                    StoredFileName = "sample.pdf",
                    StoragePath = "source.pdf",
                    FileSizeInBytes = 1024,
                    ChecksumSha256 = "original-checksum",
                    IsCurrentVersion = true,
                    CreatedByUserId = userId,
                    CreatedOnUtc = utcNow
                }
            ]);

        fileStorageService.CreateWritableFilePathAsync("versions", "sample.pdf", Arg.Any<CancellationToken>())
            .Returns("compressed.pdf");
        fileStorageService.ReadFileAsync("compressed.pdf", Arg.Any<CancellationToken>())
            .Returns(new MemoryStream([1, 2, 3, 4]));

        pdfCompressionService.CompressAsync("source.pdf", "compressed.pdf", "Balanced", Arg.Any<CancellationToken>())
            .Returns(new PdfCompressionResult(1024, 768, 0.25, TimeSpan.FromMilliseconds(42)));

        userContextAccessor.GetRequiredUserId().Returns(userId);
        clock.UtcNow.Returns(utcNow);

        var manager = new DocumentCompressionManager(
            documentRepository,
            documentVersionRepository,
            documentJobRepository,
            auditLogRepository,
            pdfCompressionService,
            fileStorageService,
            userContextAccessor,
            clock);

        var response = await manager.QueueCompressionAsync(
            documentId,
            new CompressDocumentRequest { CompressionProfile = "Balanced" },
            CancellationToken.None);

        response.JobStatus.Should().Be("Succeeded");
        response.OriginalSizeInBytes.Should().Be(1024);
        response.CompressedSizeInBytes.Should().Be(768);
        await documentJobRepository.Received(1).AddAsync(Arg.Any<DocumentJob>(), Arg.Any<CancellationToken>());
        await documentVersionRepository.Received(1).AddAsync(Arg.Any<DocumentVersion>(), Arg.Any<CancellationToken>());
        await documentRepository.Received(1).SaveChangesAsync(Arg.Any<CancellationToken>());
    }
}
