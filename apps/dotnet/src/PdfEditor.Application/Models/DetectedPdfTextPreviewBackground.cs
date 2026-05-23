namespace PdfEditor.Application.Models;

public sealed class DetectedPdfTextPreviewBackground
{
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public string ColorHex { get; init; } = "#ffffff";
    public double Opacity { get; init; } = 1d;
}
