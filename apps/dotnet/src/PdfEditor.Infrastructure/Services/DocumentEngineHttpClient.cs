using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Application.Models;
using PdfEditor.Infrastructure.Configuration;

namespace PdfEditor.Infrastructure.Services;

public sealed class DocumentEngineHttpClient
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly HttpClient httpClient;
    private readonly DocumentEngineOptions options;

    public DocumentEngineHttpClient(HttpClient httpClient, IOptions<DocumentEngineOptions> options)
    {
        this.httpClient = httpClient;
        this.options = options.Value;
    }

    public async Task<IReadOnlyCollection<DetectedPdfTextBlock>> ExtractTextBlocksAsync(string sourcePath, CancellationToken cancellationToken)
    {
        return await PostAsync<TextExtractRequest, TextExtractResponse, IReadOnlyCollection<DetectedPdfTextBlock>>(
            "/api/v1/text/extract",
            new TextExtractRequest(sourcePath),
            response => response.TextBlocks,
            cancellationToken);
    }

    public async Task<PdfResolvedFontResource> ResolveFontResourceAsync(string sourcePath, string textBlockId, string fontName, bool? isBold, bool? isItalic, CancellationToken cancellationToken)
    {
        return await PostAsync<ResolveFontResourceRequest, PdfResolvedFontResource, PdfResolvedFontResource>(
            "/api/v1/text/resolve-font",
            new ResolveFontResourceRequest(sourcePath, textBlockId, fontName, isBold, isItalic),
            response => response,
            cancellationToken);
    }

    public async Task<PdfTextLayoutPreviewResult> PreviewTextLayoutAsync(string sourcePath, string textBlockId, string text, double x, double y, double width, double height, string fontName, double fontSize, string colorHex, bool isBold, bool isItalic, CancellationToken cancellationToken)
    {
        return await PostAsync<TextLayoutPreviewRequest, PdfTextLayoutPreviewResult, PdfTextLayoutPreviewResult>(
            "/api/v1/text/preview-layout",
            new TextLayoutPreviewRequest(sourcePath, textBlockId, text, x, y, width, height, fontName, fontSize, colorHex, isBold, isItalic),
            response => response,
            cancellationToken);
    }

    public async Task<DocumentEngineCapabilities> GetCapabilitiesAsync(CancellationToken cancellationToken)
    {
        using var response = await httpClient.GetAsync("/api/v1/engine/capabilities", cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var errorMessage = await ReadErrorMessageAsync(response, cancellationToken);
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(errorMessage)
                ? "The document engine capability list could not be loaded."
                : errorMessage);
        }

        return await response.Content.ReadFromJsonAsync<DocumentEngineCapabilities>(SerializerOptions, cancellationToken)
            ?? throw new InvalidOperationException("The document engine returned an invalid capability response.");
    }

    public async Task<PdfDocumentSnapshot> GetDocumentSnapshotAsync(string sourcePath, CancellationToken cancellationToken)
    {
        return await PostAsync<DocumentSnapshotRequest, PdfDocumentSnapshot, PdfDocumentSnapshot>(
            "/api/v1/engine/snapshot",
            new DocumentSnapshotRequest(sourcePath),
            response => response,
            cancellationToken);
    }

    public async Task<PdfTextReplacementResult> ReplaceTextAsync(string sourcePath, string outputPath, string textBlockId, string replacementText, CancellationToken cancellationToken)
    {
        return await PostAsync<TextReplaceRequest, PdfTextReplacementResult, PdfTextReplacementResult>(
            "/api/v1/text/replace",
            new TextReplaceRequest(sourcePath, outputPath, textBlockId, replacementText),
            response => response,
            cancellationToken);
    }

    public async Task<PdfTextLayoutUpdateResult> UpdateTextLayoutAsync(string sourcePath, string outputPath, string textBlockId, string text, double x, double y, double width, double height, bool keepOriginal, CancellationToken cancellationToken)
    {
        return await PostAsync<TextLayoutRequest, PdfTextLayoutUpdateResult, PdfTextLayoutUpdateResult>(
            "/api/v1/text/layout",
            new TextLayoutRequest(sourcePath, outputPath, textBlockId, text, x, y, width, height, keepOriginal),
            response => response,
            cancellationToken);
    }

    public async Task ApplyTextOverlaysAsync(string sourcePath, string outputPath, IReadOnlyCollection<PdfTextOverlayOperation> operations, CancellationToken cancellationToken)
    {
        await PostAsync<TextOverlayCommitRequest, object, object>(
            "/api/v1/text/apply-overlays",
            new TextOverlayCommitRequest(
                sourcePath,
                outputPath,
                operations.Select(operation => new TextOverlayCommitOperation(
                    operation.SourceTextBlockId,
                    operation.Text,
                    operation.X,
                    operation.Y,
                    operation.Width,
                    operation.Height,
                    operation.HideSourceOnCommit,
                    operation.FontName,
                    operation.FontSize,
                    operation.ColorHex,
                    operation.IsBold,
                    operation.IsItalic,
                    operation.FontResourceName,
                    operation.FontPostScriptName,
                    operation.FontFamily,
                    operation.FontSource,
                    operation.FontResolutionStatus,
                    operation.EditCapability,
                    operation.SaveCapability,
                    operation.ToUnicodeAvailable,
                    operation.CanEmbedForEditing,
                    operation.MissingGlyphs.ToArray(),
                    operation.PreviewCoordinateSpace,
                    operation.PreviewViewportWidth,
                    operation.PreviewViewportHeight,
                    operation.PreviewLines.Select(previewLine => new TextOverlayCommitPreviewLine(
                        previewLine.Text,
                        previewLine.X,
                        previewLine.Y,
                        previewLine.BaselineY,
                        previewLine.FontSize,
                        previewLine.FontName,
                        previewLine.ColorHex,
                        previewLine.IsBold,
                        previewLine.IsItalic,
                        previewLine.Spans.Select(previewSpan => new TextOverlayCommitPreviewSpan(
                            previewSpan.Text,
                            previewSpan.X,
                            previewSpan.Width,
                            previewSpan.FontSize,
                            previewSpan.FontName,
                            previewSpan.ColorHex,
                            previewSpan.IsBold,
                            previewSpan.IsItalic)).ToArray())).ToArray())).ToArray()),
            _ => new object(),
            cancellationToken);
    }

    public async Task<PdfOcrResult> RunOcrAsync(string sourcePath, string outputPath, string languageCode, string? pageRange, bool deskew, bool forceOcr, CancellationToken cancellationToken)
    {
        return await PostAsync<TextOcrRequest, PdfOcrResult, PdfOcrResult>(
            "/api/v1/text/ocr",
            new TextOcrRequest(sourcePath, outputPath, languageCode, pageRange, deskew, forceOcr),
            response => response,
            cancellationToken);
    }

    public async Task EnsureHealthyAsync(CancellationToken cancellationToken)
    {
        AppLogger.Debug(
            message: "Document engine health check started",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"BaseUrl={options.BaseUrl}");

        using var response = await httpClient.GetAsync("/health", cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var errorMessage = await ReadErrorMessageAsync(response, cancellationToken);
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(errorMessage)
                ? "The document engine is unavailable."
                : errorMessage);
        }

        var healthPayload = await response.Content.ReadFromJsonAsync<DocumentEngineHealthPayload>(SerializerOptions, cancellationToken)
            ?? throw new InvalidOperationException("The document engine health check returned an invalid response.");

        AppLogger.Debug(
            message: "Document engine health check completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"BaseUrl={options.BaseUrl}, ServiceName={healthPayload.ServiceName}, Version={healthPayload.Version}");
    }

    private async Task<TResult> PostAsync<TRequest, TResponse, TResult>(string path, TRequest request, Func<TResponse, TResult> responseSelector, CancellationToken cancellationToken)
    {
        using var response = await httpClient.PostAsJsonAsync(path, request, SerializerOptions, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var errorMessage = await ReadErrorMessageAsync(response, cancellationToken);
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(errorMessage)
                ? "The document engine could not complete the request."
                : errorMessage);
        }

        var responsePayload = await response.Content.ReadFromJsonAsync<TResponse>(SerializerOptions, cancellationToken)
            ?? throw new InvalidOperationException("The document engine returned an invalid response.");

        return responseSelector(responsePayload);
    }

    private static async Task<string> ReadErrorMessageAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(payload))
        {
            return string.Empty;
        }

        try
        {
            var errorPayload = JsonSerializer.Deserialize<DocumentEngineErrorPayload>(payload, SerializerOptions);
            return errorPayload?.Detail ?? payload;
        }
        catch (JsonException)
        {
            return payload;
        }
    }

    private sealed record TextExtractRequest(string SourcePath);
    private sealed record TextExtractResponse(IReadOnlyCollection<DetectedPdfTextBlock> TextBlocks);
    private sealed record ResolveFontResourceRequest(string SourcePath, string TextBlockId, string FontName, bool? IsBold, bool? IsItalic);
    private sealed record DocumentSnapshotRequest(string SourcePath);
    private sealed record TextLayoutPreviewRequest(string SourcePath, string TextBlockId, string Text, double X, double Y, double Width, double Height, string FontName, double FontSize, string ColorHex, bool IsBold, bool IsItalic);
    private sealed record TextReplaceRequest(string SourcePath, string OutputPath, string TextBlockId, string ReplacementText);
    private sealed record TextLayoutRequest(string SourcePath, string OutputPath, string TextBlockId, string Text, double X, double Y, double Width, double Height, bool KeepOriginal);
    private sealed record TextOverlayCommitRequest(string SourcePath, string OutputPath, IReadOnlyCollection<TextOverlayCommitOperation> Operations);
    private sealed record TextOverlayCommitOperation(string SourceTextBlockId, string Text, double X, double Y, double Width, double Height, bool HideSourceOnCommit, string FontName, double FontSize, string ColorHex, bool IsBold, bool IsItalic, string FontResourceName, string FontPostScriptName, string FontFamily, string FontSource, string FontResolutionStatus, string EditCapability, string SaveCapability, bool ToUnicodeAvailable, bool CanEmbedForEditing, IReadOnlyCollection<string> MissingGlyphs, string PreviewCoordinateSpace, double PreviewViewportWidth, double PreviewViewportHeight, IReadOnlyCollection<TextOverlayCommitPreviewLine> PreviewLines);
    private sealed record TextOverlayCommitPreviewLine(string Text, double X, double Y, double BaselineY, double FontSize, string FontName, string ColorHex, bool IsBold, bool IsItalic, IReadOnlyCollection<TextOverlayCommitPreviewSpan> Spans);
    private sealed record TextOverlayCommitPreviewSpan(string Text, double X, double Width, double FontSize, string FontName, string ColorHex, bool IsBold, bool IsItalic);
    private sealed record TextOcrRequest(string SourcePath, string OutputPath, string LanguageCode, string? PageRange, bool Deskew, bool ForceOcr);
    private sealed record DocumentEngineErrorPayload(string Detail);
    private sealed record DocumentEngineHealthPayload(string Status, string ServiceName, string Version);
}
