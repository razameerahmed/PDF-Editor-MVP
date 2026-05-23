namespace PdfEditor.Application.Models;

public sealed class PdfDocumentPage
{
    public int PageNumber { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public int Rotation { get; init; }
}
