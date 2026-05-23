namespace PdfEditor.Contracts.Documents;

public sealed class ToolSessionResponse
{
    public Guid ToolSessionId { get; init; }
    public string Title { get; init; } = string.Empty;
    public string OriginalFileName { get; init; } = string.Empty;
    public long FileSizeInBytes { get; init; }
    public int PageCount { get; init; }
    public string FileUrl { get; init; } = string.Empty;
    public string DownloadUrl { get; init; } = string.Empty;
    public bool IsProtected { get; init; }
    public bool RequiresPassword { get; init; }
    public string? ProtectionSummary { get; init; }
    public bool HasUnsavedChanges { get; init; }
    public string? LastOperationName { get; init; }
    public string? LastOperationSummary { get; init; }
    public IReadOnlyCollection<ToolSessionAnnotationDto> Annotations { get; init; } = Array.Empty<ToolSessionAnnotationDto>();
    public IReadOnlyCollection<ToolSessionAttachmentDto> Attachments { get; init; } = Array.Empty<ToolSessionAttachmentDto>();
    public IReadOnlyCollection<ToolSessionSplitArtifactDto> SplitArtifacts { get; init; } = Array.Empty<ToolSessionSplitArtifactDto>();
    public DateTime UpdatedOnUtc { get; init; }
}
