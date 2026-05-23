using PdfEditor.Domain.Common;

namespace PdfEditor.Domain.Entities;

public sealed class DocumentAnnotation : AuditableEntity
{
    public Guid DocumentAnnotationId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid DocumentVersionId { get; set; }
    public string AnnotationType { get; set; } = string.Empty;
    public int PageNumber { get; set; }
    public string AnnotationPayloadJson { get; set; } = "{}";
    public bool IsDeleted { get; set; }
}
