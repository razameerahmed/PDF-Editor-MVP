namespace PdfEditor.Application.Models;

public sealed class PdfOcrResult
{
    public string OperationType { get; init; } = "ocr";
    public string LanguageCode { get; init; } = "eng";
    public string? PageRange { get; init; }
    public bool Deskew { get; init; }
    public bool ForceOcr { get; init; }
}
