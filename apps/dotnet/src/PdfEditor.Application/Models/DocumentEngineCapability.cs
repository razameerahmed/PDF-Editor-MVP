namespace PdfEditor.Application.Models;

public sealed class DocumentEngineCapability
{
    public string CapabilityName { get; init; } = string.Empty;
    public bool IsAvailable { get; init; }
    public string Description { get; init; } = string.Empty;
}
