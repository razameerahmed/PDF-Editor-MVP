namespace PdfEditor.Contracts.Documents;

public sealed class DocumentVersionDto
{
    public Guid DocumentVersionId { get; init; }
    public int VersionNumber { get; init; }
    public string VersionLabel { get; init; } = string.Empty;
    public string VersionStatus { get; init; } = string.Empty;
    public bool IsCurrentVersion { get; init; }
    public long FileSizeInBytes { get; init; }
    public DateTime CreatedOnUtc { get; init; }
}
