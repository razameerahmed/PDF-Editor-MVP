namespace PdfEditor.Contracts.Documents;

public sealed class DocumentAnnotationDto
{
    public Guid DocumentAnnotationId { get; init; }
    public Guid DocumentVersionId { get; init; }
    public string AnnotationType { get; init; } = string.Empty;
    public int PageNumber { get; init; }
    public string AnnotationPayloadJson { get; init; } = "{}";
    public DateTime UpdatedOnUtc { get; init; }
}
