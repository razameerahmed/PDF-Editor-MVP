namespace PdfEditor.Contracts.Documents;

public sealed class SaveToolSessionResponse
{
    public required DocumentSummaryDto Document { get; init; }
    public int SavedAnnotationCount { get; init; }
}
