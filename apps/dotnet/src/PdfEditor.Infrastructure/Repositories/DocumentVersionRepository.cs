using Microsoft.EntityFrameworkCore;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Domain.Entities;
using PdfEditor.Infrastructure.Persistence;

namespace PdfEditor.Infrastructure.Repositories;

public sealed class DocumentVersionRepository : IDocumentVersionRepository
{
    private readonly PdfEditorDbContext dbContext;

    public DocumentVersionRepository(PdfEditorDbContext dbContext) => this.dbContext = dbContext;

    public Task AddAsync(DocumentVersion documentVersion, CancellationToken cancellationToken) =>
        dbContext.DocumentVersions.AddAsync(documentVersion, cancellationToken).AsTask();

    public async Task<IReadOnlyCollection<DocumentVersion>> GetByDocumentIdAsync(Guid documentId, CancellationToken cancellationToken) =>
        await dbContext.DocumentVersions
            .AsNoTracking()
            .Where(version => version.DocumentId == documentId)
            .OrderByDescending(version => version.VersionNumber)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyCollection<DocumentVersion>> GetTrackedByDocumentIdAsync(Guid documentId, CancellationToken cancellationToken) =>
        await dbContext.DocumentVersions
            .Where(version => version.DocumentId == documentId)
            .OrderByDescending(version => version.VersionNumber)
            .ToListAsync(cancellationToken);
}
