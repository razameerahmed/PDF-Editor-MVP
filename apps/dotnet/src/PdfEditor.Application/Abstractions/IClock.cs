namespace PdfEditor.Application.Abstractions;

public interface IClock
{
    DateTime UtcNow { get; }
}
