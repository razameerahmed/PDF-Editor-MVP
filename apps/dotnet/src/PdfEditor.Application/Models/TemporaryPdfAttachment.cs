namespace PdfEditor.Application.Models;

public sealed class TemporaryPdfAttachment
{
    public Guid ToolSessionAttachmentId { get; init; }
    public string AttachmentType { get; init; } = "File";
    public string FileName { get; init; } = string.Empty;
    public string MimeType { get; init; } = "application/octet-stream";
    public string StoragePath { get; init; } = string.Empty;
    public long FileSizeInBytes { get; init; }
    public DateTime CreatedOnUtc { get; init; }
}
