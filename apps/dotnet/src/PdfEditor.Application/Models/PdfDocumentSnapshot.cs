namespace PdfEditor.Application.Models;

public sealed class PdfDocumentSnapshot
{
    public string ServiceName { get; init; } = string.Empty;
    public string Version { get; init; } = string.Empty;
    public string DocumentFingerprintSha256 { get; init; } = string.Empty;
    public int PageCount { get; init; }
    public IReadOnlyCollection<PdfDocumentPage> Pages { get; init; } = Array.Empty<PdfDocumentPage>();
    public IReadOnlyCollection<DetectedPdfTextBlock> TextBlocks { get; init; } = Array.Empty<DetectedPdfTextBlock>();
    public IReadOnlyCollection<DocumentEngineCapability> Capabilities { get; init; } = Array.Empty<DocumentEngineCapability>();
}
