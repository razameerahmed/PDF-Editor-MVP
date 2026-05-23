using Microsoft.EntityFrameworkCore;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Domain.Entities;
using PdfEditor.Infrastructure.Persistence;

namespace PdfEditor.Infrastructure.Repositories;

public sealed class DocumentAnnotationRepository : IDocumentAnnotationRepository
{
    private readonly PdfEditorDbContext dbContext;

    public DocumentAnnotationRepository(PdfEditorDbContext dbContext) => this.dbContext = dbContext;

    public Task AddAsync(DocumentAnnotation annotation, CancellationToken cancellationToken) =>
        dbContext.DocumentAnnotations.AddAsync(annotation, cancellationToken).AsTask();

    public async Task<IReadOnlyCollection<DocumentAnnotation>> GetActiveByDocumentIdAsync(Guid documentId, CancellationToken cancellationToken) =>
        await dbContext.DocumentAnnotations
            .AsNoTracking()
            .Where(annotation => annotation.DocumentId == documentId && !annotation.IsDeleted)
            .OrderBy(annotation => annotation.PageNumber)
            .ToListAsync(cancellationToken);
}
