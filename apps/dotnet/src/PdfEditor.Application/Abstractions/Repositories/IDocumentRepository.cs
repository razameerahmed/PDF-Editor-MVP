using PdfEditor.Domain.Entities;

namespace PdfEditor.Application.Abstractions.Repositories;

public interface IDocumentRepository
{
    Task AddAsync(Document document, CancellationToken cancellationToken);
    Task<Document?> GetByIdAsync(Guid documentId, CancellationToken cancellationToken);
    Task<Document?> GetTrackedByIdAsync(Guid documentId, CancellationToken cancellationToken);
    Task<IReadOnlyCollection<Document>> SearchAsync(string? searchTerm, int pageNumber, int pageSize, CancellationToken cancellationToken);
    Task<int> CountAsync(string? searchTerm, CancellationToken cancellationToken);
    Task SaveChangesAsync(CancellationToken cancellationToken);
}
