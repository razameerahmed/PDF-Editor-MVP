namespace PdfEditor.Contracts.Documents;

public sealed class ToolSessionTextOperationResponse
{
    public ToolSessionResponse Session { get; init; } = new();
    public ToolSessionTextOperationDto Operation { get; init; } = new();
}
