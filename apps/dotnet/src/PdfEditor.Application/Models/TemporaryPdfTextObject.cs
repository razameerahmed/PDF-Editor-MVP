namespace PdfEditor.Application.Models;

public sealed class TemporaryPdfTextObject
{
    public Guid ToolSessionTextObjectId { get; init; }
    public string CurrentTextBlockId { get; set; } = string.Empty;
    public string SourceTextBlockId { get; set; } = string.Empty;
    public int PageNumber { get; set; }
    public int SourcePageNumber { get; set; }
    public string Text { get; set; } = string.Empty;
    public string SourceText { get; set; } = string.Empty;
    public double X { get; set; }
    public double SourceX { get; set; }
    public double Y { get; set; }
    public double SourceY { get; set; }
    public double Width { get; set; }
    public double SourceWidth { get; set; }
    public double Height { get; set; }
    public double SourceHeight { get; set; }
    public double FontSize { get; set; }
    public double SourceFontSize { get; set; }
    public string FontName { get; set; } = string.Empty;
    public string SourceFontName { get; set; } = string.Empty;
    public string FontResourceName { get; set; } = string.Empty;
    public string SourceFontResourceName { get; set; } = string.Empty;
    public string FontPostScriptName { get; set; } = string.Empty;
    public string SourceFontPostScriptName { get; set; } = string.Empty;
    public string FontFamily { get; set; } = string.Empty;
    public string SourceFontFamily { get; set; } = string.Empty;
    public string FontSource { get; set; } = string.Empty;
    public string SourceFontSource { get; set; } = string.Empty;
    public string ColorHex { get; set; } = "#000000";
    public string SourceColorHex { get; set; } = "#000000";
    public bool IsBold { get; set; }
    public bool SourceIsBold { get; set; }
    public bool IsItalic { get; set; }
    public bool SourceIsItalic { get; set; }
    public string FontResolutionStatus { get; set; } = "exact-source";
    public string SourceFontResolutionStatus { get; set; } = "exact-source";
    public string EditCapability { get; set; } = "exact-editable";
    public string SourceEditCapability { get; set; } = "exact-editable";
    public string SaveCapability { get; set; } = "exact-save";
    public string SourceSaveCapability { get; set; } = "exact-save";
    public bool ToUnicodeAvailable { get; set; }
    public bool SourceToUnicodeAvailable { get; set; }
    public bool CanEmbedForEditing { get; set; } = true;
    public bool SourceCanEmbedForEditing { get; set; } = true;
    public string PreviewMode { get; set; } = "source";
    public string PreviewCoordinateSpace { get; set; } = "legacy-fitted";
    public string SourcePreviewCoordinateSpace { get; set; } = "legacy-fitted";
    public double RenderedFontSize { get; set; }
    public double SourceRenderedFontSize { get; set; }
    public double LineHeightRatio { get; set; } = 1.15d;
    public double SourceLineHeightRatio { get; set; } = 1.15d;
    public double PreviewViewportWidth { get; set; }
    public double SourcePreviewViewportWidth { get; set; }
    public double PreviewViewportHeight { get; set; }
    public double SourcePreviewViewportHeight { get; set; }
    public string LayoutContainerId { get; set; } = string.Empty;
    public string SourceLayoutContainerId { get; set; } = string.Empty;
    public string EditableRunId { get; set; } = string.Empty;
    public string SourceEditableRunId { get; set; } = string.Empty;
    public string DocumentEditMode { get; set; } = "digital-text";
    public string SourceDocumentEditMode { get; set; } = "digital-text";
    public string PageEditMode { get; set; } = "digital-text";
    public string SourcePageEditMode { get; set; } = "digital-text";
    public IReadOnlyCollection<string> MissingGlyphs { get; set; } = Array.Empty<string>();
    public IReadOnlyCollection<string> SourceMissingGlyphs { get; set; } = Array.Empty<string>();
    public IReadOnlyCollection<string> LayoutLines { get; set; } = Array.Empty<string>();
    public IReadOnlyCollection<string> SourceLayoutLines { get; set; } = Array.Empty<string>();
    public IReadOnlyCollection<DetectedPdfTextPreviewLine> PreviewLines { get; set; } = Array.Empty<DetectedPdfTextPreviewLine>();
    public IReadOnlyCollection<DetectedPdfTextPreviewLine> SourcePreviewLines { get; set; } = Array.Empty<DetectedPdfTextPreviewLine>();
    public IReadOnlyCollection<DetectedPdfTextPreviewBackground> PreviewBackgrounds { get; set; } = Array.Empty<DetectedPdfTextPreviewBackground>();
    public IReadOnlyCollection<DetectedPdfTextPreviewBackground> SourcePreviewBackgrounds { get; set; } = Array.Empty<DetectedPdfTextPreviewBackground>();
    public bool IsOverlayObject { get; set; }
    public bool HideSourceOnCommit { get; set; }
    public DateTime UpdatedOnUtc { get; set; }
}
