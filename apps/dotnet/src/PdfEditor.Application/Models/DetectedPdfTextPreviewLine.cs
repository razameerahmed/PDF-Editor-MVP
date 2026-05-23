namespace PdfEditor.Application.Models;

public sealed class DetectedPdfTextPreviewLine
{
    public string Text { get; init; } = string.Empty;
    public double X { get; init; }
    public double Y { get; init; }
    public double BaselineY { get; init; }
    public double FontSize { get; init; }
    public string FontName { get; init; } = string.Empty;
    public string ColorHex { get; init; } = "#000000";
    public bool IsBold { get; init; }
    public bool IsItalic { get; init; }
    public IReadOnlyCollection<DetectedPdfTextPreviewSpan> Spans { get; init; } = Array.Empty<DetectedPdfTextPreviewSpan>();
}
