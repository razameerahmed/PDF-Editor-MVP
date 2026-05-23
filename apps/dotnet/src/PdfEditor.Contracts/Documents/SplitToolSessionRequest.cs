namespace PdfEditor.Contracts.Documents;

public sealed class SplitToolSessionRequest
{
    public IReadOnlyCollection<string> PageRanges { get; init; } = Array.Empty<string>();
}
