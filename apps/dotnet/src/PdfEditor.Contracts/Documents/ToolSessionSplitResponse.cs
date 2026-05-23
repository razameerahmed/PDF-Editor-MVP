namespace PdfEditor.Contracts.Documents;

public sealed class ToolSessionSplitResponse
{
    public ToolSessionResponse Session { get; init; } = new();
    public IReadOnlyCollection<ToolSessionSplitArtifactDto> Files { get; init; } = Array.Empty<ToolSessionSplitArtifactDto>();
}
