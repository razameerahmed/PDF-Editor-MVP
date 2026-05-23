using PdfEditor.Application.Abstractions;
using PdfEditor.Contracts.Documents;

namespace PdfEditor.Application.Managers;

public sealed class EditorResourceManager
{
    private readonly IInstalledFontCatalogService installedFontCatalogService;

    public EditorResourceManager(IInstalledFontCatalogService installedFontCatalogService)
    {
        this.installedFontCatalogService = installedFontCatalogService;
    }

    public async Task<GetInstalledEditorFontsResponse> GetInstalledFontsAsync(CancellationToken cancellationToken)
    {
        var fontNames = await installedFontCatalogService.GetInstalledFontNamesAsync(cancellationToken);

        return new GetInstalledEditorFontsResponse
        {
            FontNames = fontNames
        };
    }
}
