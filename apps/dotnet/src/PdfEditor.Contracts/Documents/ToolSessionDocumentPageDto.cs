namespace PdfEditor.Contracts.Documents;

public sealed class ToolSessionDocumentPageDto
{
    public int PageNumber { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public int Rotation { get; init; }
}
