using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Common.Logging;

namespace PdfEditor.Infrastructure.Services;

public sealed class DocumentEngineStartupValidator
{
    private static readonly string[] RequiredCapabilities =
    {
        "document-snapshot",
        "text-extraction",
        "text-replacement",
        "text-layout-update"
    };

    private readonly IDocumentEngineService documentEngineService;
    private readonly DocumentEngineHttpClient documentEngineHttpClient;

    public DocumentEngineStartupValidator(IDocumentEngineService documentEngineService, DocumentEngineHttpClient documentEngineHttpClient)
    {
        this.documentEngineService = documentEngineService;
        this.documentEngineHttpClient = documentEngineHttpClient;
    }

    public async Task ValidateAsync(CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Document engine startup validation began",
            action: "Validate",
            result: "Started",
            updatedBy: string.Empty,
            description: string.Empty);

        await documentEngineHttpClient.EnsureHealthyAsync(cancellationToken);
        var capabilities = await documentEngineService.GetCapabilitiesAsync(cancellationToken);

        var missingCapabilities = RequiredCapabilities
            .Where(requiredCapability => capabilities.Capabilities.All(capability =>
                !string.Equals(capability.CapabilityName, requiredCapability, StringComparison.OrdinalIgnoreCase)
                || !capability.IsAvailable))
            .ToArray();

        if (missingCapabilities.Length > 0)
        {
            throw new InvalidOperationException($"The document engine is missing required capabilities: {string.Join(", ", missingCapabilities)}.");
        }

        AppLogger.Info(
            message: "Document engine startup validation completed successfully",
            action: "Validate",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ServiceName={capabilities.ServiceName}, Version={capabilities.Version}");
    }
}
