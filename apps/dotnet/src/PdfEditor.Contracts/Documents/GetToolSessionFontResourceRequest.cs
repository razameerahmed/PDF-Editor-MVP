namespace PdfEditor.Contracts.Documents;

public sealed class GetToolSessionFontResourceRequest
{
    public string TextObjectId { get; init; } = string.Empty;
    public string TextBlockId { get; init; } = string.Empty;
    public string FontName { get; init; } = string.Empty;
    public bool? IsBold { get; init; }
    public bool? IsItalic { get; init; }
}
