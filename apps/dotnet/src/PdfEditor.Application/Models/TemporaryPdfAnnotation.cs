namespace PdfEditor.Application.Models;

public sealed class TemporaryPdfAnnotation
{
    public Guid ToolSessionAnnotationId { get; init; }
    public string AnnotationType { get; init; } = string.Empty;
    public int PageNumber { get; init; }
    public string AnnotationPayloadJson { get; init; } = "{}";
    public DateTime UpdatedOnUtc { get; init; }
}
