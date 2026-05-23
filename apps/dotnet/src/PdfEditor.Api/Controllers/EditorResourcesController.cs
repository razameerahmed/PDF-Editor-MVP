using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PdfEditor.Application.Managers;

namespace PdfEditor.Api.Controllers;

[ApiController]
[Route("api/v1/editor-resources")]
public sealed class EditorResourcesController : ApiControllerBase
{
    private readonly EditorResourceManager editorResourceManager;

    public EditorResourcesController(EditorResourceManager editorResourceManager)
    {
        this.editorResourceManager = editorResourceManager;
    }

    [HttpGet("fonts")]
    [AllowAnonymous]
    public async Task<IActionResult> GetInstalledFontsAsync(CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => editorResourceManager.GetInstalledFontsAsync(cancellationToken),
            "Installed Windows fonts loaded successfully.",
            "View",
            "EditorResource=InstalledFonts");
}
