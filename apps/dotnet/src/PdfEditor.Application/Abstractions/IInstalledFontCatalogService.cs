namespace PdfEditor.Application.Abstractions;

public interface IInstalledFontCatalogService
{
    Task<IReadOnlyCollection<string>> GetInstalledFontNamesAsync(CancellationToken cancellationToken);
}
