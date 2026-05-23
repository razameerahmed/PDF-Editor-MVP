namespace PdfEditor.Application.Models;

public sealed class PdfTextOverlayOperation
{
    public string SourceTextBlockId { get; init; } = string.Empty;
    public string Text { get; init; } = string.Empty;
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public bool HideSourceOnCommit { get; init; }
    public string FontName { get; init; } = string.Empty;
    public double FontSize { get; init; }
    public string ColorHex { get; init; } = "#000000";
    public bool IsBold { get; init; }
    public bool IsItalic { get; init; }
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
    public string PreviewCoordinateSpace { get; init; } = "legacy-fitted";
    public double PreviewViewportWidth { get; init; }
    public double PreviewViewportHeight { get; init; }
    public IReadOnlyCollection<DetectedPdfTextPreviewLine> PreviewLines { get; init; } = Array.Empty<DetectedPdfTextPreviewLine>();
}
