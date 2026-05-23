namespace PdfEditor.Contracts.Documents;

public sealed class ReorderPagesRequest
{
    public IReadOnlyCollection<int> OrderedPageNumbers { get; init; } = [];
}
