namespace PdfEditor.Contracts.Documents;

public sealed class DocumentDownloadDto
{
    public required string FileName { get; init; }
    public required string MimeType { get; init; }
    public required Stream ContentStream { get; init; }
}
