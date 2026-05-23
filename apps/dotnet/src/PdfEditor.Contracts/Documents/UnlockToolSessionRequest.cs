namespace PdfEditor.Contracts.Documents;

public sealed class UnlockToolSessionRequest
{
    public string Password { get; init; } = string.Empty;
}
