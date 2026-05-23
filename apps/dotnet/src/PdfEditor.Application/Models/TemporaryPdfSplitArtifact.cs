namespace PdfEditor.Application.Models;

public sealed class TemporaryPdfSplitArtifact
{
    public Guid ToolSessionSplitArtifactId { get; init; }
    public string PageRange { get; init; } = string.Empty;
    public string FileName { get; init; } = string.Empty;
    public string StoragePath { get; init; } = string.Empty;
    public long FileSizeInBytes { get; init; }
    public DateTime CreatedOnUtc { get; init; }
}
