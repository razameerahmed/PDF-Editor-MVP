namespace PdfEditor.Infrastructure.Configuration;

public sealed class DatabaseStartupOptions
{
    public bool AutoInitializeSchema { get; init; }
    public bool SeedDemoData { get; init; }
}
