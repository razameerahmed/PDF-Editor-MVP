namespace PdfEditor.Contracts.Documents;

public sealed class CompressDocumentResponse
{
    public Guid DocumentJobId { get; init; }
    public Guid DocumentVersionId { get; init; }
    public string JobStatus { get; init; } = string.Empty;
    public long OriginalSizeInBytes { get; init; }
    public long CompressedSizeInBytes { get; init; }
    public double CompressionRatio { get; init; }
    public long ProcessingDurationMilliseconds { get; init; }
}
