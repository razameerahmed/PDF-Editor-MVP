using PdfEditor.Domain.Common;
using PdfEditor.Domain.Enums;

namespace PdfEditor.Domain.Entities;

public sealed class Document : AuditableEntity
{
    public Guid DocumentId { get; set; }
    public string OriginalFileName { get; set; } = string.Empty;
    public string StoredFileName { get; set; } = string.Empty;
    public string FileExtension { get; set; } = ".pdf";
    public string MimeType { get; set; } = "application/pdf";
    public long FileSizeInBytes { get; set; }
    public int CurrentVersionNumber { get; set; } = 1;
    public DocumentStatus DocumentStatus { get; set; } = DocumentStatus.Active;
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public Guid UploadedByUserId { get; set; }
    public string StorageProvider { get; set; } = "Local";
    public string StoragePath { get; set; } = string.Empty;
    public string ChecksumSha256 { get; set; } = string.Empty;
    public bool IsDeleted { get; set; }
    public byte[] RowVersion { get; set; } = [];
    public ICollection<DocumentVersion> Versions { get; set; } = [];
    public ICollection<DocumentAnnotation> Annotations { get; set; } = [];
    public ICollection<DocumentJob> Jobs { get; set; } = [];
}
