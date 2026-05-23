namespace PdfEditor.Infrastructure.Configuration;

public sealed class DocumentEngineOptions
{
    public string BaseUrl { get; init; } = "http://127.0.0.1:8787";
    public int RequestTimeoutSeconds { get; init; } = 60;
}
