using PdfEditor.Application.Models;

namespace PdfEditor.Application.Abstractions;

public interface ITemporaryPdfSessionService
{
    Task<TemporaryPdfSession> CreateAsync(string title, string originalFileName, Stream fileStream, CancellationToken cancellationToken);
    Task<TemporaryPdfSession> CreateFromStoragePathAsync(string title, string originalFileName, string storagePath, CancellationToken cancellationToken);
    Task<TemporaryPdfSession> GetRequiredAsync(Guid toolSessionId, CancellationToken cancellationToken);
    Task<TemporaryPdfSession> AddAttachmentAsync(Guid toolSessionId, TemporaryPdfAttachment attachment, string? lastOperationName, string? lastOperationSummary, CancellationToken cancellationToken);
    Task<TemporaryPdfSession> RemoveAttachmentAsync(Guid toolSessionId, Guid toolSessionAttachmentId, string? lastOperationName, string? lastOperationSummary, CancellationToken cancellationToken);
    Task<TemporaryPdfSession> UpdateAnnotationsAsync(Guid toolSessionId, IReadOnlyCollection<TemporaryPdfAnnotation> annotations, string? lastOperationName, string? lastOperationSummary, CancellationToken cancellationToken);
    Task<TemporaryPdfSession> UpdateTextObjectsAsync(Guid toolSessionId, IReadOnlyCollection<TemporaryPdfTextObject> textObjects, string? lastOperationName, string? lastOperationSummary, CancellationToken cancellationToken);
    Task<TemporaryPdfSession> UpdateCurrentFileAsync(Guid toolSessionId, string newStoragePath, string? lastOperationName, string? lastOperationSummary, IReadOnlyCollection<TemporaryPdfAnnotation>? annotations, CancellationToken cancellationToken);
    Task<TemporaryPdfSession> UpdateSplitArtifactsAsync(Guid toolSessionId, IReadOnlyCollection<TemporaryPdfSplitArtifact> splitArtifacts, string? lastOperationName, string? lastOperationSummary, CancellationToken cancellationToken);
}
