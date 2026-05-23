namespace PdfEditor.Contracts.Documents;

public sealed class DeletePagesRequest
{
    public IReadOnlyCollection<int> PageNumbers { get; init; } = [];
}
