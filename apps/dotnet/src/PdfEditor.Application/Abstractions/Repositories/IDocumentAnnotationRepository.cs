using PdfEditor.Domain.Entities;

namespace PdfEditor.Application.Abstractions.Repositories;

public interface IDocumentAnnotationRepository
{
    Task AddAsync(DocumentAnnotation annotation, CancellationToken cancellationToken);
    Task<IReadOnlyCollection<DocumentAnnotation>> GetActiveByDocumentIdAsync(Guid documentId, CancellationToken cancellationToken);
}
