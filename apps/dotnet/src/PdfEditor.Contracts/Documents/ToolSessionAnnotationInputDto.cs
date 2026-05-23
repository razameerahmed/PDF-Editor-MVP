namespace PdfEditor.Contracts.Documents;

public sealed class ToolSessionAnnotationInputDto
{
    public Guid? ToolSessionAnnotationId { get; init; }
    public string AnnotationType { get; init; } = string.Empty;
    public int PageNumber { get; init; }
    public string AnnotationPayloadJson { get; init; } = "{}";
}
