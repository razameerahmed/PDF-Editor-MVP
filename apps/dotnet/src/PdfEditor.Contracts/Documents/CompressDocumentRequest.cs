namespace PdfEditor.Contracts.Documents;

public sealed class CompressDocumentRequest
{
    public string CompressionProfile { get; init; } = "Balanced";
}
