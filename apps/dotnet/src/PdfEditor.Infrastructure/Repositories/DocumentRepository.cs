using Microsoft.EntityFrameworkCore;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Domain.Entities;
using PdfEditor.Infrastructure.Persistence;

namespace PdfEditor.Infrastructure.Repositories;

public sealed class DocumentRepository : IDocumentRepository
{
    private readonly PdfEditorDbContext dbContext;

    public DocumentRepository(PdfEditorDbContext dbContext) => this.dbContext = dbContext;

    public Task AddAsync(Document document, CancellationToken cancellationToken) =>
        dbContext.Documents.AddAsync(document, cancellationToken).AsTask();

    public Task<Document?> GetByIdAsync(Guid documentId, CancellationToken cancellationToken) =>
        dbContext.Documents.AsNoTracking().SingleOrDefaultAsync(document => document.DocumentId == documentId, cancellationToken);

    public Task<Document?> GetTrackedByIdAsync(Guid documentId, CancellationToken cancellationToken) =>
        dbContext.Documents.SingleOrDefaultAsync(document => document.DocumentId == documentId, cancellationToken);

    public async Task<IReadOnlyCollection<Document>> SearchAsync(string? searchTerm, int pageNumber, int pageSize, CancellationToken cancellationToken)
    {
        var query = dbContext.Documents.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            query = query.Where(document => document.Title.Contains(searchTerm) || document.OriginalFileName.Contains(searchTerm));
        }

        return await query
            .OrderByDescending(document => document.CreatedOnUtc)
            .Skip((pageNumber - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);
    }

    public Task<int> CountAsync(string? searchTerm, CancellationToken cancellationToken)
    {
        var query = dbContext.Documents.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            query = query.Where(document => document.Title.Contains(searchTerm) || document.OriginalFileName.Contains(searchTerm));
        }

        return query.CountAsync(cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken) => dbContext.SaveChangesAsync(cancellationToken);
}
