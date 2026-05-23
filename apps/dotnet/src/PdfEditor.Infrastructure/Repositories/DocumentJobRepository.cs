using Microsoft.EntityFrameworkCore;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Domain.Entities;
using PdfEditor.Infrastructure.Persistence;

namespace PdfEditor.Infrastructure.Repositories;

public sealed class DocumentJobRepository : IDocumentJobRepository
{
    private readonly PdfEditorDbContext dbContext;

    public DocumentJobRepository(PdfEditorDbContext dbContext) => this.dbContext = dbContext;

    public Task AddAsync(DocumentJob job, CancellationToken cancellationToken) =>
        dbContext.DocumentJobs.AddAsync(job, cancellationToken).AsTask();

    public Task<DocumentJob?> GetByIdAsync(Guid documentJobId, CancellationToken cancellationToken) =>
        dbContext.DocumentJobs.AsNoTracking().SingleOrDefaultAsync(job => job.DocumentJobId == documentJobId, cancellationToken);

    public async Task<IReadOnlyCollection<DocumentJob>> GetByDocumentIdAsync(Guid documentId, CancellationToken cancellationToken) =>
        await dbContext.DocumentJobs.AsNoTracking()
            .Where(job => job.DocumentId == documentId)
            .OrderByDescending(job => job.CreatedOnUtc)
            .ToListAsync(cancellationToken);
}
