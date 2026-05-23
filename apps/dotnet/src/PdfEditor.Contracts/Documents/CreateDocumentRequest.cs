namespace PdfEditor.Contracts.Documents;

public sealed class CreateDocumentRequest
{
    public string? Title { get; init; }
    public string? Description { get; init; }
}
