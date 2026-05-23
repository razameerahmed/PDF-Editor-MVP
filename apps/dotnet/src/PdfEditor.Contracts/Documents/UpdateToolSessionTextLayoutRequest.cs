namespace PdfEditor.Contracts.Documents;

public sealed class UpdateToolSessionTextLayoutRequest
{
    public string TextObjectId { get; init; } = string.Empty;
    public string TextBlockId { get; init; } = string.Empty;
    public string Text { get; init; } = string.Empty;
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public bool KeepOriginal { get; init; }
    public string? FontName { get; init; }
    public double? FontSize { get; init; }
    public string? ColorHex { get; init; }
    public bool? IsBold { get; init; }
    public bool? IsItalic { get; init; }
}
