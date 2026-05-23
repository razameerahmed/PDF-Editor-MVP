using PdfEditor.Application.Abstractions;

namespace PdfEditor.Infrastructure.Services;

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}
