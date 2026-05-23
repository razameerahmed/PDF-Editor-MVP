namespace PdfEditor.Contracts.Documents;

public sealed class DocumentSummaryDto
{
    public Guid DocumentId { get; init; }
    public string Title { get; init; } = string.Empty;
    public string OriginalFileName { get; init; } = string.Empty;
    public long FileSizeInBytes { get; init; }
    public int CurrentVersionNumber { get; init; }
    public string DocumentStatus { get; init; } = string.Empty;
    public bool IsDeleted { get; init; }
    public DateTime CreatedOnUtc { get; init; }
}
