namespace PdfEditor.Contracts.Documents;

public sealed class GetToolSessionDocumentSnapshotResponse
{
    public Guid ToolSessionId { get; init; }
    public string DocumentFingerprintSha256 { get; init; } = string.Empty;
    public int PageCount { get; init; }
    public IReadOnlyCollection<ToolSessionDocumentPageDto> Pages { get; init; } = Array.Empty<ToolSessionDocumentPageDto>();
    public IReadOnlyCollection<ToolSessionDetectedTextBlockDto> TextBlocks { get; init; } = Array.Empty<ToolSessionDetectedTextBlockDto>();
    public IReadOnlyCollection<ToolSessionDocumentEngineCapabilityDto> Capabilities { get; init; } = Array.Empty<ToolSessionDocumentEngineCapabilityDto>();
}
