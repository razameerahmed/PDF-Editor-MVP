using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using PdfEditor.Domain.Entities;
using PdfEditor.Infrastructure.Persistence;
using PdfEditor.Infrastructure.Repositories;

namespace PdfEditor.Infrastructure.Tests;

public sealed class DocumentRepositoryTests
{
    [Fact]
    public async Task SearchAsync_ShouldReturnInsertedDocument()
    {
        var options = new DbContextOptionsBuilder<PdfEditorDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var dbContext = new PdfEditorDbContext(options);
        dbContext.Documents.Add(new Document
        {
            DocumentId = Guid.NewGuid(),
            Title = "Quarterly Report",
            OriginalFileName = "quarterly-report.pdf",
            StoredFileName = "stored.pdf",
            StoragePath = "storage/originals/stored.pdf",
            ChecksumSha256 = "abc",
            CreatedOnUtc = DateTime.UtcNow,
            UpdatedOnUtc = DateTime.UtcNow
        });
        await dbContext.SaveChangesAsync();

        var repository = new DocumentRepository(dbContext);
        var results = await repository.SearchAsync("Quarterly", 1, 20, CancellationToken.None);

        results.Should().ContainSingle();
    }
}
