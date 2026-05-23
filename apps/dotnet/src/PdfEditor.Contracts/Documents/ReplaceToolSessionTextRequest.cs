namespace PdfEditor.Contracts.Documents;

public sealed class ReplaceToolSessionTextRequest
{
    public string TextObjectId { get; init; } = string.Empty;
    public string TextBlockId { get; init; } = string.Empty;
    public string ReplacementText { get; init; } = string.Empty;
    public string? FontName { get; init; }
    public double? FontSize { get; init; }
    public string? ColorHex { get; init; }
    public bool? IsBold { get; init; }
    public bool? IsItalic { get; init; }
}
