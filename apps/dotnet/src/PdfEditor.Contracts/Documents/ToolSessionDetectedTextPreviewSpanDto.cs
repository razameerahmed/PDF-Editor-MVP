namespace PdfEditor.Contracts.Documents;

public sealed class ToolSessionDetectedTextPreviewSpanDto
{
    public string Text { get; init; } = string.Empty;
    public double X { get; init; }
    public double Width { get; init; }
    public double FontSize { get; init; }
    public string FontName { get; init; } = string.Empty;
    public string ColorHex { get; init; } = "#000000";
    public bool IsBold { get; init; }
    public bool IsItalic { get; init; }
}
