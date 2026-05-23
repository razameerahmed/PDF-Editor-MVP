namespace PdfEditor.Contracts.Documents;

public sealed class ToolSessionAttachmentDto
{
    public Guid ToolSessionAttachmentId { get; init; }
    public string AttachmentType { get; init; } = string.Empty;
    public string FileName { get; init; } = string.Empty;
    public string MimeType { get; init; } = string.Empty;
    public string DownloadUrl { get; init; } = string.Empty;
    public long FileSizeInBytes { get; init; }
}
