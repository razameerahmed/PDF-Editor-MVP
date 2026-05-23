namespace PdfEditor.Application.Models;

public sealed class PdfTextReplacementResult
{
    public string SourceTextBlockId { get; init; } = string.Empty;
    public int PageNumber { get; init; }
    public string OriginalText { get; init; } = string.Empty;
    public string ReplacementText { get; init; } = string.Empty;
    public DetectedPdfTextBlock? ResultTextBlock { get; init; }
}
