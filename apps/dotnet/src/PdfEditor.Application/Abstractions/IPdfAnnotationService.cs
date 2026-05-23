namespace PdfEditor.Application.Abstractions;

public interface IPdfAnnotationService
{
    Task<string> NormalizeAnnotationPayloadAsync(string annotationType, string annotationPayloadJson, CancellationToken cancellationToken);
}
