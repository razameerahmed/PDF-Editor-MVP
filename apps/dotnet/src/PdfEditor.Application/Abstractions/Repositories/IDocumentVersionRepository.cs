using PdfEditor.Domain.Entities;

namespace PdfEditor.Application.Abstractions.Repositories;

public interface IDocumentVersionRepository
{
    Task AddAsync(DocumentVersion documentVersion, CancellationToken cancellationToken);
    Task<IReadOnlyCollection<DocumentVersion>> GetByDocumentIdAsync(Guid documentId, CancellationToken cancellationToken);
    Task<IReadOnlyCollection<DocumentVersion>> GetTrackedByDocumentIdAsync(Guid documentId, CancellationToken cancellationToken);
}
