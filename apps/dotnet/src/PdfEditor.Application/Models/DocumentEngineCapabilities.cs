namespace PdfEditor.Application.Models;

public sealed class DocumentEngineCapabilities
{
    public string ServiceName { get; init; } = string.Empty;
    public string Version { get; init; } = string.Empty;
    public IReadOnlyCollection<DocumentEngineCapability> Capabilities { get; init; } = Array.Empty<DocumentEngineCapability>();
}
