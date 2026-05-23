namespace PdfEditor.Contracts.Documents;

public sealed class ToolSessionTextOperationDto
{
    public string OperationType { get; init; } = string.Empty;
    public string SourceTextObjectId { get; init; } = string.Empty;
    public string SourceTextBlockId { get; init; } = string.Empty;
    public ToolSessionDetectedTextBlockDto? ResultTextBlock { get; init; }
    public int PageNumber { get; init; }
    public string OriginalText { get; init; } = string.Empty;
    public string Text { get; init; } = string.Empty;
    public bool KeepOriginal { get; init; }
}
