namespace PdfEditor.Application.Models;

public sealed class ToolSessionUploadFile
{
    public string OriginalFileName { get; init; } = string.Empty;
    public Stream FileStream { get; init; } = Stream.Null;
}
