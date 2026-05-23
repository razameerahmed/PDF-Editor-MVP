namespace PdfEditor.Contracts.Documents;

public sealed class RunToolSessionOcrRequest
{
    public string LanguageCode { get; init; } = "eng";
    public string? PageRange { get; init; }
    public bool Deskew { get; init; } = true;
    public bool ForceOcr { get; init; }
}
