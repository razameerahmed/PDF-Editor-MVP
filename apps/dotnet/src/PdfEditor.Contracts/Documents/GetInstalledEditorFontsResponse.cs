namespace PdfEditor.Contracts.Documents;

public sealed class GetInstalledEditorFontsResponse
{
    public IReadOnlyCollection<string> FontNames { get; init; } = Array.Empty<string>();
}
