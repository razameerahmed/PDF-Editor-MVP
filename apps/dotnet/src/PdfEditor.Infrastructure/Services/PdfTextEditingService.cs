using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Models;

namespace PdfEditor.Infrastructure.Services;

public sealed class PdfTextEditingService : IPdfTextEditingService
{
    private readonly IDocumentEngineService documentEngineService;

    public PdfTextEditingService(IDocumentEngineService documentEngineService)
    {
        this.documentEngineService = documentEngineService;
    }

    public async Task<IReadOnlyCollection<DetectedPdfTextBlock>> ExtractTextBlocksAsync(string sourcePath, CancellationToken cancellationToken)
    {
        return await documentEngineService.ExtractTextBlocksAsync(sourcePath, cancellationToken);
    }

    public async Task<PdfResolvedFontResource> ResolveFontResourceAsync(string sourcePath, string textBlockId, string fontName, bool? isBold, bool? isItalic, CancellationToken cancellationToken)
    {
        return await documentEngineService.ResolveFontResourceAsync(sourcePath, textBlockId, fontName, isBold, isItalic, cancellationToken);
    }

    public async Task<PdfTextLayoutPreviewResult> PreviewTextLayoutAsync(string sourcePath, string textBlockId, string text, double x, double y, double width, double height, string fontName, double fontSize, string colorHex, bool isBold, bool isItalic, CancellationToken cancellationToken)
    {
        return await documentEngineService.PreviewTextLayoutAsync(sourcePath, textBlockId, text, x, y, width, height, fontName, fontSize, colorHex, isBold, isItalic, cancellationToken);
    }

    public async Task<PdfTextReplacementResult> ReplaceTextAsync(string sourcePath, string outputPath, string textBlockId, string replacementText, CancellationToken cancellationToken)
    {
        return await documentEngineService.ReplaceTextAsync(sourcePath, outputPath, textBlockId, replacementText, cancellationToken);
    }

    public async Task<PdfTextLayoutUpdateResult> UpdateTextLayoutAsync(string sourcePath, string outputPath, string textBlockId, string text, double x, double y, double width, double height, bool keepOriginal, CancellationToken cancellationToken)
    {
        return await documentEngineService.UpdateTextLayoutAsync(sourcePath, outputPath, textBlockId, text, x, y, width, height, keepOriginal, cancellationToken);
    }

    public async Task ApplyTextOverlaysAsync(string sourcePath, string outputPath, IReadOnlyCollection<PdfTextOverlayOperation> operations, CancellationToken cancellationToken)
    {
        await documentEngineService.ApplyTextOverlaysAsync(sourcePath, outputPath, operations, cancellationToken);
    }

    public async Task<PdfOcrResult> RunOcrAsync(string sourcePath, string outputPath, string languageCode, string? pageRange, bool deskew, bool forceOcr, CancellationToken cancellationToken)
    {
        return await documentEngineService.RunOcrAsync(sourcePath, outputPath, languageCode, pageRange, deskew, forceOcr, cancellationToken);
    }
}
