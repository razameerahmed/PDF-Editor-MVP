using System.Text.Json;
using PdfEditor.Application.Abstractions;

namespace PdfEditor.Infrastructure.Services;

public sealed class PdfAnnotationService : IPdfAnnotationService
{
    public Task<string> NormalizeAnnotationPayloadAsync(string annotationType, string annotationPayloadJson, CancellationToken cancellationToken)
    {
        using var jsonDocument = JsonDocument.Parse(annotationPayloadJson);
        return Task.FromResult(JsonSerializer.Serialize(new
        {
            annotationType,
            payload = jsonDocument.RootElement
        }));
    }
}
