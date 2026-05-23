namespace PdfEditor.Contracts.Documents;

public sealed class GetToolSessionDetectedTextResponse
{
    public Guid ToolSessionId { get; init; }
    public IReadOnlyCollection<ToolSessionDetectedTextBlockDto> TextBlocks { get; init; } = Array.Empty<ToolSessionDetectedTextBlockDto>();
}
