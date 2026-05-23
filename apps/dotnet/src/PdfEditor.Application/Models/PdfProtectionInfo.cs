namespace PdfEditor.Application.Models;

public sealed class PdfProtectionInfo
{
    public bool IsProtected { get; init; }
    public bool RequiresPassword { get; init; }
    public string Summary { get; init; } = string.Empty;
}
