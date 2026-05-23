using PdfEditor.Domain.Entities;

namespace PdfEditor.Application.Abstractions.Repositories;

public interface IDocumentJobRepository
{
    Task AddAsync(DocumentJob job, CancellationToken cancellationToken);
    Task<DocumentJob?> GetByIdAsync(Guid documentJobId, CancellationToken cancellationToken);
    Task<IReadOnlyCollection<DocumentJob>> GetByDocumentIdAsync(Guid documentId, CancellationToken cancellationToken);
}
