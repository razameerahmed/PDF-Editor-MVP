namespace PdfEditor.Contracts.Documents;

public sealed class ToolSessionDetectedTextBlockDto
{
    public string TextObjectId { get; init; } = string.Empty;
    public string TextBlockId { get; init; } = string.Empty;
    public string SourceTextBlockId { get; init; } = string.Empty;
    public int PageNumber { get; init; }
    public int SourcePageNumber { get; init; }
    public string Text { get; init; } = string.Empty;
    public double X { get; init; }
    public double SourceX { get; init; }
    public double Y { get; init; }
    public double SourceY { get; init; }
    public double Width { get; init; }
    public double SourceWidth { get; init; }
    public double Height { get; init; }
    public double SourceHeight { get; init; }
    public double FontSize { get; init; }
    public double SourceFontSize { get; init; }
    public string FontName { get; init; } = string.Empty;
    public string SourceFontName { get; init; } = string.Empty;
    public string ColorHex { get; init; } = "#000000";
    public string SourceColorHex { get; init; } = "#000000";
    public bool IsBold { get; init; }
    public bool SourceIsBold { get; init; }
    public bool IsItalic { get; init; }
    public bool SourceIsItalic { get; init; }
    public string PreviewMode { get; init; } = "source";
    public string PreviewCoordinateSpace { get; init; } = "legacy-fitted";
    public string SourcePreviewCoordinateSpace { get; init; } = "legacy-fitted";
    public double RenderedFontSize { get; init; }
    public double SourceRenderedFontSize { get; init; }
    public double LineHeightRatio { get; init; } = 1.15d;
    public double SourceLineHeightRatio { get; init; } = 1.15d;
    public double PreviewViewportWidth { get; init; }
    public double SourcePreviewViewportWidth { get; init; }
    public double PreviewViewportHeight { get; init; }
    public double SourcePreviewViewportHeight { get; init; }
    public string LayoutContainerId { get; init; } = string.Empty;
    public string SourceLayoutContainerId { get; init; } = string.Empty;
    public string EditableRunId { get; init; } = string.Empty;
    public string SourceEditableRunId { get; init; } = string.Empty;
    public string DocumentEditMode { get; init; } = "digital-text";
    public string SourceDocumentEditMode { get; init; } = "digital-text";
    public string PageEditMode { get; init; } = "digital-text";
    public string SourcePageEditMode { get; init; } = "digital-text";
    public string FontResourceName { get; init; } = string.Empty;
    public string SourceFontResourceName { get; init; } = string.Empty;
    public string FontPostScriptName { get; init; } = string.Empty;
    public string SourceFontPostScriptName { get; init; } = string.Empty;
    public string FontFamily { get; init; } = string.Empty;
    public string SourceFontFamily { get; init; } = string.Empty;
    public string FontSource { get; init; } = string.Empty;
    public string SourceFontSource { get; init; } = string.Empty;
    public string FontResolutionStatus { get; init; } = "exact-source";
    public string SourceFontResolutionStatus { get; init; } = "exact-source";
    public string EditCapability { get; init; } = "exact-editable";
    public string SourceEditCapability { get; init; } = "exact-editable";
    public string SaveCapability { get; init; } = "exact-save";
    public string SourceSaveCapability { get; init; } = "exact-save";
    public bool ToUnicodeAvailable { get; init; }
    public bool SourceToUnicodeAvailable { get; init; }
    public bool CanEmbedForEditing { get; init; } = true;
    public bool SourceCanEmbedForEditing { get; init; } = true;
    public IReadOnlyCollection<string> MissingGlyphs { get; init; } = Array.Empty<string>();
    public IReadOnlyCollection<string> SourceMissingGlyphs { get; init; } = Array.Empty<string>();
    public IReadOnlyCollection<string> LayoutLines { get; init; } = Array.Empty<string>();
    public IReadOnlyCollection<string> SourceLayoutLines { get; init; } = Array.Empty<string>();
    public IReadOnlyCollection<ToolSessionDetectedTextPreviewLineDto> PreviewLines { get; init; } = Array.Empty<ToolSessionDetectedTextPreviewLineDto>();
    public IReadOnlyCollection<ToolSessionDetectedTextPreviewLineDto> SourcePreviewLines { get; init; } = Array.Empty<ToolSessionDetectedTextPreviewLineDto>();
    public IReadOnlyCollection<ToolSessionDetectedTextPreviewBackgroundDto> PreviewBackgrounds { get; init; } = Array.Empty<ToolSessionDetectedTextPreviewBackgroundDto>();
    public IReadOnlyCollection<ToolSessionDetectedTextPreviewBackgroundDto> SourcePreviewBackgrounds { get; init; } = Array.Empty<ToolSessionDetectedTextPreviewBackgroundDto>();
    public bool IsOverlayObject { get; init; }
    public bool HideSourceOnCommit { get; init; }
}
