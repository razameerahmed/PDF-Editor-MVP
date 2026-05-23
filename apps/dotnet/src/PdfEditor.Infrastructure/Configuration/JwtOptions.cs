namespace PdfEditor.Infrastructure.Configuration;

public sealed class JwtOptions
{
    public string Issuer { get; init; } = "PdfEditor";
    public string Audience { get; init; } = "PdfEditor.Web";
    public string SigningKey { get; init; } = "ChangeThisDevelopmentKey_123456789";
    public int AccessTokenMinutes { get; init; } = 30;
}
