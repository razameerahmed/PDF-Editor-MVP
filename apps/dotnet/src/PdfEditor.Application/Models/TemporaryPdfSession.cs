namespace PdfEditor.Application.Models;

public sealed class TemporaryPdfSession
{
    public Guid ToolSessionId { get; init; }
    public string Title { get; set; } = string.Empty;
    public string OriginalFileName { get; init; } = string.Empty;
    public string OriginalStoragePath { get; init; } = string.Empty;
    public string CurrentStoragePath { get; set; } = string.Empty;
    public string MimeType { get; init; } = "application/pdf";
    public string? LastOperationName { get; set; }
    public string? LastOperationSummary { get; set; }
    public IReadOnlyCollection<TemporaryPdfAnnotation> Annotations { get; set; } = Array.Empty<TemporaryPdfAnnotation>();
    public IReadOnlyCollection<TemporaryPdfAttachment> Attachments { get; set; } = Array.Empty<TemporaryPdfAttachment>();
    public IReadOnlyCollection<TemporaryPdfTextObject> TextObjects { get; set; } = Array.Empty<TemporaryPdfTextObject>();
    public IReadOnlyCollection<TemporaryPdfTextObjectHistoryEntry> TextObjectUndoStack { get; set; } = Array.Empty<TemporaryPdfTextObjectHistoryEntry>();
    public string TextObjectsBaseStoragePath { get; set; } = string.Empty;
    public IReadOnlyCollection<TemporaryPdfSplitArtifact> SplitArtifacts { get; set; } = Array.Empty<TemporaryPdfSplitArtifact>();
    public DateTime CreatedOnUtc { get; init; }
    public DateTime UpdatedOnUtc { get; set; }
}

public sealed class TemporaryPdfTextObjectHistoryEntry
{
    public Guid HistoryEntryId { get; init; } = Guid.NewGuid();
    public string OperationName { get; init; } = string.Empty;
    public IReadOnlyCollection<TemporaryPdfTextObject> TextObjects { get; init; } = Array.Empty<TemporaryPdfTextObject>();
    public DateTime CreatedOnUtc { get; init; } = DateTime.UtcNow;
}
