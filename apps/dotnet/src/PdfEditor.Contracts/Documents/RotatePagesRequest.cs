namespace PdfEditor.Contracts.Documents;

public sealed class RotatePagesRequest
{
    public IReadOnlyCollection<int> PageNumbers { get; init; } = [];
    public int Degrees { get; init; }
}
