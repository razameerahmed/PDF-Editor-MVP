namespace PdfEditor.Contracts.Documents;

public sealed class PageOperationResponse
{
    public Guid DocumentId { get; init; }
    public Guid DocumentVersionId { get; init; }
    public string OperationName { get; init; } = string.Empty;
    public string Message { get; init; } = string.Empty;
}
