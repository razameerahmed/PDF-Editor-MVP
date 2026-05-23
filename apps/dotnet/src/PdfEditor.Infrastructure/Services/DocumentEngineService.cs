using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Application.Models;

namespace PdfEditor.Infrastructure.Services;

public sealed class DocumentEngineService : IDocumentEngineService
{
    private readonly DocumentEngineHttpClient documentEngineHttpClient;

    public DocumentEngineService(DocumentEngineHttpClient documentEngineHttpClient)
    {
        this.documentEngineHttpClient = documentEngineHttpClient;
    }

    public async Task<DocumentEngineCapabilities> GetCapabilitiesAsync(CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document engine capability request received",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: string.Empty);

        var capabilities = await documentEngineHttpClient.GetCapabilitiesAsync(cancellationToken);

        AppLogger.Info(
            message: "Document engine capability request completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ServiceName={capabilities.ServiceName}, Version={capabilities.Version}, CapabilityCount={capabilities.Capabilities.Count}");

        return capabilities;
    }

    public async Task<PdfDocumentSnapshot> GetDocumentSnapshotAsync(string sourcePath, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document engine snapshot request received",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}");

        var snapshot = await documentEngineHttpClient.GetDocumentSnapshotAsync(sourcePath, cancellationToken);

        AppLogger.Info(
            message: "Document engine snapshot request completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, PageCount={snapshot.PageCount}, TextBlockCount={snapshot.TextBlocks.Count}");

        return snapshot;
    }

    public async Task<IReadOnlyCollection<DetectedPdfTextBlock>> ExtractTextBlocksAsync(string sourcePath, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document engine text extraction request received",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}");

        var textBlocks = (await documentEngineHttpClient.ExtractTextBlocksAsync(sourcePath, cancellationToken))
            .Where(textBlock => !string.IsNullOrWhiteSpace(textBlock.TextBlockId))
            .ToArray();

        AppLogger.Info(
            message: "Document engine text extraction request completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, TextBlockCount={textBlocks.Length}");

        return textBlocks;
    }

    public async Task<PdfResolvedFontResource> ResolveFontResourceAsync(string sourcePath, string textBlockId, string fontName, bool? isBold, bool? isItalic, CancellationToken cancellationToken)
    {
        AppLogger.Debug(
            message: "Document engine font resource request started",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, TextBlockId={textBlockId}, FontName={fontName}, IsBold={isBold}, IsItalic={isItalic}");

        var response = await documentEngineHttpClient.ResolveFontResourceAsync(sourcePath, textBlockId, fontName, isBold, isItalic, cancellationToken);

        AppLogger.Debug(
            message: "Document engine font resource request completed",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, TextBlockId={textBlockId}, RequestedFontName={response.RequestedFontName}, ResolvedFontName={response.ResolvedFontName}, FontSource={response.FontSource}, IsFallback={response.IsFallback}");

        return response;
    }

    public async Task<PdfTextReplacementResult> ReplaceTextAsync(string sourcePath, string outputPath, string textBlockId, string replacementText, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document engine text replacement request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, OutputPath={outputPath}, TextBlockId={textBlockId}");

        var response = await documentEngineHttpClient.ReplaceTextAsync(sourcePath, outputPath, textBlockId, replacementText, cancellationToken);

        if (!File.Exists(outputPath))
        {
            throw new InvalidOperationException("The edited PDF could not be created. Please try the text change again.");
        }

        AppLogger.Info(
            message: "Document engine text replacement request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"OutputPath={outputPath}, TextBlockId={response.SourceTextBlockId}, PageNumber={response.PageNumber}");

        return response;
    }

    public async Task<PdfTextLayoutPreviewResult> PreviewTextLayoutAsync(string sourcePath, string textBlockId, string text, double x, double y, double width, double height, string fontName, double fontSize, string colorHex, bool isBold, bool isItalic, CancellationToken cancellationToken)
    {
        AppLogger.Debug(
            message: "Document engine text layout preview started",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, TextBlockId={textBlockId}, X={x}, Y={y}, Width={width}, Height={height}, FontName={fontName}, FontSize={fontSize}, ColorHex={colorHex}, IsBold={isBold}, IsItalic={isItalic}");

        var response = await documentEngineHttpClient.PreviewTextLayoutAsync(sourcePath, textBlockId, text, x, y, width, height, fontName, fontSize, colorHex, isBold, isItalic, cancellationToken);

        AppLogger.Debug(
            message: "Document engine text layout preview completed",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, TextBlockId={textBlockId}, ResultTextBlockId={response.ResultTextBlock.TextBlockId}");

        return response;
    }

    public async Task<PdfTextLayoutUpdateResult> UpdateTextLayoutAsync(string sourcePath, string outputPath, string textBlockId, string text, double x, double y, double width, double height, bool keepOriginal, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document engine text layout update request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, OutputPath={outputPath}, TextBlockId={textBlockId}, KeepOriginal={keepOriginal}");

        var response = await documentEngineHttpClient.UpdateTextLayoutAsync(sourcePath, outputPath, textBlockId, text, x, y, width, height, keepOriginal, cancellationToken);

        if (!File.Exists(outputPath))
        {
            throw new InvalidOperationException("The PDF text layout update could not be created. Please try the action again.");
        }

        AppLogger.Info(
            message: "Document engine text layout update request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"OutputPath={outputPath}, TextBlockId={response.SourceTextBlockId}, KeepOriginal={keepOriginal}");

        return response;
    }

    public async Task ApplyTextOverlaysAsync(string sourcePath, string outputPath, IReadOnlyCollection<PdfTextOverlayOperation> operations, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document engine text overlay commit request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, OutputPath={outputPath}, OverlayCount={operations.Count}");

        await documentEngineHttpClient.ApplyTextOverlaysAsync(sourcePath, outputPath, operations, cancellationToken);

        if (!File.Exists(outputPath))
        {
            throw new InvalidOperationException("The overlay PDF commit could not be created. Please try the action again.");
        }

        AppLogger.Info(
            message: "Document engine text overlay commit request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"OutputPath={outputPath}, OverlayCount={operations.Count}");
    }

    public async Task<PdfOcrResult> RunOcrAsync(string sourcePath, string outputPath, string languageCode, string? pageRange, bool deskew, bool forceOcr, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document engine OCR request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, OutputPath={outputPath}, LanguageCode={languageCode}, PageRange={pageRange}, Deskew={deskew}, ForceOcr={forceOcr}");

        var response = await documentEngineHttpClient.RunOcrAsync(sourcePath, outputPath, languageCode, pageRange, deskew, forceOcr, cancellationToken);

        if (!File.Exists(outputPath))
        {
            throw new InvalidOperationException("The OCR output PDF could not be created. Please try the OCR run again.");
        }

        AppLogger.Info(
            message: "Document engine OCR request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"OutputPath={outputPath}, LanguageCode={response.LanguageCode}, PageRange={response.PageRange}, Deskew={response.Deskew}, ForceOcr={response.ForceOcr}");

        return response;
    }
}
