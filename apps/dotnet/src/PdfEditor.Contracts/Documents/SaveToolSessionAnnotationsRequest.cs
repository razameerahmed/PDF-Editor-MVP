namespace PdfEditor.Contracts.Documents;

public sealed class SaveToolSessionAnnotationsRequest
{
    public IReadOnlyCollection<ToolSessionAnnotationInputDto> Annotations { get; init; } = Array.Empty<ToolSessionAnnotationInputDto>();
}
