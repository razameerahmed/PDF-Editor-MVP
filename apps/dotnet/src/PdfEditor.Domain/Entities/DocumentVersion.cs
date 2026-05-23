using PdfEditor.Domain.Enums;

namespace PdfEditor.Domain.Entities;

public sealed class DocumentVersion
{
    public Guid DocumentVersionId { get; set; }
    public Guid DocumentId { get; set; }
    public int VersionNumber { get; set; }
    public string VersionLabel { get; set; } = string.Empty;
    public DocumentVersionStatus VersionStatus { get; set; }
    public string StoredFileName { get; set; } = string.Empty;
    public string StoragePath { get; set; } = string.Empty;
    public long FileSizeInBytes { get; set; }
    public string ChecksumSha256 { get; set; } = string.Empty;
    public Guid? SourceJobId { get; set; }
    public string? ChangeSummary { get; set; }
    public bool IsCurrentVersion { get; set; }
    public Guid CreatedByUserId { get; set; }
    public DateTime CreatedOnUtc { get; set; }
    public Document Document { get; set; } = null!;
}
