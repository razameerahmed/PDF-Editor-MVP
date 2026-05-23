namespace PdfEditor.Contracts.Authentication;

public sealed record LoginRequest(string EmailAddress, string Password);
