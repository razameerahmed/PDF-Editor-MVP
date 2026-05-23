namespace PdfEditor.Contracts.Documents;

public sealed class GetDocumentByIdResponse
{
    public required DocumentSummaryDto Document { get; init; }
    public required IReadOnlyCollection<DocumentVersionDto> Versions { get; init; }
    public required IReadOnlyCollection<CompressionJobDto> Jobs { get; init; }
}
