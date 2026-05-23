namespace PdfEditor.Contracts.Documents;

public sealed class ToolSessionCompressionResponse
{
    public required ToolSessionResponse Session { get; init; }
    public string CompressionProfile { get; init; } = string.Empty;
    public long OriginalSizeInBytes { get; init; }
    public long CompressedSizeInBytes { get; init; }
    public double CompressionRatio { get; init; }
    public long ProcessingDurationMilliseconds { get; init; }
}
