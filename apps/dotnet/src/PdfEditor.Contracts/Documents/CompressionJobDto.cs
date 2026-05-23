namespace PdfEditor.Contracts.Documents;

public sealed class CompressionJobDto
{
    public Guid DocumentJobId { get; init; }
    public string JobType { get; init; } = string.Empty;
    public string JobStatus { get; init; } = string.Empty;
    public string? CompressionProfile { get; init; }
    public string? FailureReason { get; init; }
    public DateTime CreatedOnUtc { get; init; }
}
