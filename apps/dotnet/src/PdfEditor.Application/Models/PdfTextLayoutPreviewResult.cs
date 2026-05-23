namespace PdfEditor.Application.Models;

public sealed class PdfTextLayoutPreviewResult
{
    public string SourceTextBlockId { get; init; } = string.Empty;
    public string Text { get; init; } = string.Empty;
    public int PageNumber { get; init; }
    public DetectedPdfTextBlock ResultTextBlock { get; init; } = new();
}
