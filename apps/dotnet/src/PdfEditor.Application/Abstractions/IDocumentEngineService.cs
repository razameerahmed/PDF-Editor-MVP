using PdfEditor.Application.Models;

namespace PdfEditor.Application.Abstractions;

public interface IDocumentEngineService
{
    Task<DocumentEngineCapabilities> GetCapabilitiesAsync(CancellationToken cancellationToken);
    Task<PdfDocumentSnapshot> GetDocumentSnapshotAsync(string sourcePath, CancellationToken cancellationToken);
    Task<IReadOnlyCollection<DetectedPdfTextBlock>> ExtractTextBlocksAsync(string sourcePath, CancellationToken cancellationToken);
    Task<PdfResolvedFontResource> ResolveFontResourceAsync(string sourcePath, string textBlockId, string fontName, bool? isBold, bool? isItalic, CancellationToken cancellationToken);
    Task<PdfTextLayoutPreviewResult> PreviewTextLayoutAsync(string sourcePath, string textBlockId, string text, double x, double y, double width, double height, string fontName, double fontSize, string colorHex, bool isBold, bool isItalic, CancellationToken cancellationToken);
    Task<PdfTextReplacementResult> ReplaceTextAsync(string sourcePath, string outputPath, string textBlockId, string replacementText, CancellationToken cancellationToken);
    Task<PdfTextLayoutUpdateResult> UpdateTextLayoutAsync(string sourcePath, string outputPath, string textBlockId, string text, double x, double y, double width, double height, bool keepOriginal, CancellationToken cancellationToken);
    Task ApplyTextOverlaysAsync(string sourcePath, string outputPath, IReadOnlyCollection<PdfTextOverlayOperation> operations, CancellationToken cancellationToken);
    Task<PdfOcrResult> RunOcrAsync(string sourcePath, string outputPath, string languageCode, string? pageRange, bool deskew, bool forceOcr, CancellationToken cancellationToken);
}
