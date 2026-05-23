using System.Collections.Concurrent;
using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Models;

namespace PdfEditor.Infrastructure.Services;

public sealed class TemporaryPdfSessionService : ITemporaryPdfSessionService
{
    private readonly IFileStorageService fileStorageService;
    private readonly ConcurrentDictionary<Guid, TemporaryPdfSession> sessions = new();

    public TemporaryPdfSessionService(IFileStorageService fileStorageService)
    {
        this.fileStorageService = fileStorageService;
    }

    public async Task<TemporaryPdfSession> CreateAsync(string title, string originalFileName, Stream fileStream, CancellationToken cancellationToken)
    {
        var utcNow = DateTime.UtcNow;
        var storagePath = await fileStorageService.SaveFileAsync(fileStream, "temp", originalFileName, cancellationToken);

        return CreateSession(title, originalFileName, storagePath, utcNow);
    }

    public Task<TemporaryPdfSession> CreateFromStoragePathAsync(string title, string originalFileName, string storagePath, CancellationToken cancellationToken)
    {
        var utcNow = DateTime.UtcNow;
        return Task.FromResult(CreateSession(title, originalFileName, storagePath, utcNow));
    }

    public Task<TemporaryPdfSession> GetRequiredAsync(Guid toolSessionId, CancellationToken cancellationToken)
    {
        if (sessions.TryGetValue(toolSessionId, out var session))
        {
            return Task.FromResult(session);
        }

        throw new KeyNotFoundException("The PDF session could not be found. Upload the file again and continue.");
    }

    public async Task<TemporaryPdfSession> AddAttachmentAsync(
        Guid toolSessionId,
        TemporaryPdfAttachment attachment,
        string? lastOperationName,
        string? lastOperationSummary,
        CancellationToken cancellationToken)
    {
        var session = await GetRequiredAsync(toolSessionId, cancellationToken);
        session.Attachments = session.Attachments.Concat([attachment]).ToArray();
        session.LastOperationName = lastOperationName;
        session.LastOperationSummary = lastOperationSummary;
        session.UpdatedOnUtc = DateTime.UtcNow;
        return session;
    }

    public async Task<TemporaryPdfSession> RemoveAttachmentAsync(
        Guid toolSessionId,
        Guid toolSessionAttachmentId,
        string? lastOperationName,
        string? lastOperationSummary,
        CancellationToken cancellationToken)
    {
        var session = await GetRequiredAsync(toolSessionId, cancellationToken);
        var attachment = session.Attachments.FirstOrDefault(currentAttachment => currentAttachment.ToolSessionAttachmentId == toolSessionAttachmentId)
            ?? throw new KeyNotFoundException("The file attachment could not be found. Add it again and continue.");

        session.Attachments = session.Attachments
            .Where(currentAttachment => currentAttachment.ToolSessionAttachmentId != toolSessionAttachmentId)
            .ToArray();
        session.LastOperationName = lastOperationName;
        session.LastOperationSummary = lastOperationSummary;
        session.UpdatedOnUtc = DateTime.UtcNow;

        await fileStorageService.DeleteFileAsync(attachment.StoragePath, cancellationToken);
        return session;
    }

    public async Task<TemporaryPdfSession> UpdateAnnotationsAsync(
        Guid toolSessionId,
        IReadOnlyCollection<TemporaryPdfAnnotation> annotations,
        string? lastOperationName,
        string? lastOperationSummary,
        CancellationToken cancellationToken)
    {
        var session = await GetRequiredAsync(toolSessionId, cancellationToken);
        session.Annotations = annotations;
        session.LastOperationName = lastOperationName;
        session.LastOperationSummary = lastOperationSummary;
        session.UpdatedOnUtc = DateTime.UtcNow;
        return session;
    }

    public async Task<TemporaryPdfSession> UpdateTextObjectsAsync(
        Guid toolSessionId,
        IReadOnlyCollection<TemporaryPdfTextObject> textObjects,
        string? lastOperationName,
        string? lastOperationSummary,
        CancellationToken cancellationToken)
    {
        var session = await GetRequiredAsync(toolSessionId, cancellationToken);
        session.TextObjects = textObjects;

        if (lastOperationName is not null)
        {
            session.LastOperationName = lastOperationName;
        }

        if (lastOperationSummary is not null)
        {
            session.LastOperationSummary = lastOperationSummary;
        }

        session.UpdatedOnUtc = DateTime.UtcNow;
        return session;
    }

    public async Task<TemporaryPdfSession> UpdateCurrentFileAsync(
        Guid toolSessionId,
        string newStoragePath,
        string? lastOperationName,
        string? lastOperationSummary,
        IReadOnlyCollection<TemporaryPdfAnnotation>? annotations,
        CancellationToken cancellationToken)
    {
        var session = await GetRequiredAsync(toolSessionId, cancellationToken);
        var previousStoragePath = session.CurrentStoragePath;

        await DeleteSplitArtifactsAsync(session.SplitArtifacts, cancellationToken);

        session.CurrentStoragePath = newStoragePath;
        session.LastOperationName = lastOperationName;
        session.LastOperationSummary = lastOperationSummary;
        session.Annotations = annotations ?? session.Annotations;
        session.TextObjects = Array.Empty<TemporaryPdfTextObject>();
        session.TextObjectUndoStack = Array.Empty<TemporaryPdfTextObjectHistoryEntry>();
        session.TextObjectsBaseStoragePath = string.Empty;
        session.SplitArtifacts = Array.Empty<TemporaryPdfSplitArtifact>();
        session.UpdatedOnUtc = DateTime.UtcNow;

        if (!string.Equals(previousStoragePath, session.OriginalStoragePath, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(previousStoragePath, newStoragePath, StringComparison.OrdinalIgnoreCase))
        {
            await fileStorageService.DeleteFileAsync(previousStoragePath, cancellationToken);
        }

        return session;
    }

    public async Task<TemporaryPdfSession> UpdateSplitArtifactsAsync(
        Guid toolSessionId,
        IReadOnlyCollection<TemporaryPdfSplitArtifact> splitArtifacts,
        string? lastOperationName,
        string? lastOperationSummary,
        CancellationToken cancellationToken)
    {
        var session = await GetRequiredAsync(toolSessionId, cancellationToken);

        await DeleteSplitArtifactsAsync(session.SplitArtifacts, cancellationToken);

        session.SplitArtifacts = splitArtifacts;
        session.LastOperationName = lastOperationName;
        session.LastOperationSummary = lastOperationSummary;
        session.UpdatedOnUtc = DateTime.UtcNow;

        return session;
    }

    private TemporaryPdfSession CreateSession(string title, string originalFileName, string storagePath, DateTime utcNow)
    {
        var session = new TemporaryPdfSession
        {
            ToolSessionId = Guid.NewGuid(),
            Title = title,
            OriginalFileName = originalFileName,
            OriginalStoragePath = storagePath,
            CurrentStoragePath = storagePath,
            CreatedOnUtc = utcNow,
            UpdatedOnUtc = utcNow
        };

        sessions[session.ToolSessionId] = session;
        return session;
    }

    private async Task DeleteSplitArtifactsAsync(IEnumerable<TemporaryPdfSplitArtifact> splitArtifacts, CancellationToken cancellationToken)
    {
        foreach (var splitArtifact in splitArtifacts)
        {
            await fileStorageService.DeleteFileAsync(splitArtifact.StoragePath, cancellationToken);
        }
    }
}
