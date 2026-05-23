namespace PdfEditor.Application.Models;

public sealed class DetectedPdfTextBlock
{
    public string TextBlockId { get; init; } = string.Empty;
    public int PageNumber { get; init; }
    public string Text { get; init; } = string.Empty;
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public double FontSize { get; init; }
    public string FontName { get; init; } = string.Empty;
    public string ColorHex { get; init; } = "#000000";
    public bool IsBold { get; init; }
    public bool IsItalic { get; init; }
    public double RenderedFontSize { get; init; }
    public double LineHeightRatio { get; init; } = 1.15d;
    public string PreviewMode { get; init; } = "source";
    public string PreviewCoordinateSpace { get; init; } = "legacy-fitted";
    public double PreviewViewportWidth { get; init; }
    public double PreviewViewportHeight { get; init; }
    public string LayoutContainerId { get; init; } = string.Empty;
    public string EditableRunId { get; init; } = string.Empty;
    public string DocumentEditMode { get; init; } = "digital-text";
    public string PageEditMode { get; init; } = "digital-text";
    public string FontResourceName { get; init; } = string.Empty;
    public string FontPostScriptName { get; init; } = string.Empty;
    public string FontFamily { get; init; } = string.Empty;
    public string FontSource { get; init; } = string.Empty;
    public string FontResolutionStatus { get; init; } = "exact-source";
    public string EditCapability { get; init; } = "exact-editable";
    public string SaveCapability { get; init; } = "exact-save";
    public bool ToUnicodeAvailable { get; init; }
    public bool CanEmbedForEditing { get; init; } = true;
    public IReadOnlyCollection<string> MissingGlyphs { get; init; } = Array.Empty<string>();
    public IReadOnlyCollection<string> LayoutLines { get; init; } = Array.Empty<string>();
    public IReadOnlyCollection<DetectedPdfTextPreviewLine> PreviewLines { get; init; } = Array.Empty<DetectedPdfTextPreviewLine>();
    public IReadOnlyCollection<DetectedPdfTextPreviewBackground> PreviewBackgrounds { get; init; } = Array.Empty<DetectedPdfTextPreviewBackground>();
}
