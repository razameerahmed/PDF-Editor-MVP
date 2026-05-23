namespace PdfEditor.Contracts.Documents;

public sealed class ToolSessionSplitArtifactDto
{
    public Guid ToolSessionSplitArtifactId { get; init; }
    public string PageRange { get; init; } = string.Empty;
    public string FileName { get; init; } = string.Empty;
    public string DownloadUrl { get; init; } = string.Empty;
    public long FileSizeInBytes { get; init; }
}
