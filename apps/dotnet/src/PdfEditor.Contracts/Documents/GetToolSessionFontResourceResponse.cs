namespace PdfEditor.Contracts.Documents;

public sealed class GetToolSessionFontResourceResponse
{
    public string RequestedFontName { get; init; } = string.Empty;
    public string ResolvedFontName { get; init; } = string.Empty;
    public string FontFamily { get; init; } = string.Empty;
    public string FontSource { get; init; } = string.Empty;
    public string FontFormat { get; init; } = string.Empty;
    public string ContentType { get; init; } = "application/octet-stream";
    public string FontDataBase64 { get; init; } = string.Empty;
    public string SourceFontResourceName { get; init; } = string.Empty;
    public string SourceFontPostScriptName { get; init; } = string.Empty;
    public string SourceFontFamily { get; init; } = string.Empty;
    public string FontResolutionStatus { get; init; } = "exact-source";
    public bool ToUnicodeAvailable { get; init; }
    public bool CanEmbedForEditing { get; init; } = true;
    public string EditCapability { get; init; } = "exact-editable";
    public string SaveCapability { get; init; } = "exact-save";
    public IReadOnlyCollection<string> MissingGlyphs { get; init; } = Array.Empty<string>();
    public bool IsFallback { get; init; }
    public string Warning { get; init; } = string.Empty;
}
