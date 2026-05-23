using PdfEditor.Domain.Enums;

namespace PdfEditor.Domain.Entities;

public sealed class DocumentJob
{
    public Guid DocumentJobId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid? SourceDocumentVersionId { get; set; }
    public Guid? OutputDocumentVersionId { get; set; }
    public DocumentJobType JobType { get; set; }
    public DocumentJobStatus JobStatus { get; set; }
    public Guid RequestedByUserId { get; set; }
    public CompressionProfile? CompressionProfile { get; set; }
    public DateTime? StartedOnUtc { get; set; }
    public DateTime? CompletedOnUtc { get; set; }
    public string? FailureReason { get; set; }
    public string MetadataJson { get; set; } = "{}";
    public DateTime CreatedOnUtc { get; set; }
}
