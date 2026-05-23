namespace PdfEditor.Infrastructure.Configuration;

public sealed class StorageOptions
{
    public string RootPath { get; init; } = "runtime/storage";
    public string OriginalsPath { get; init; } = "originals";
    public string VersionsPath { get; init; } = "versions";
    public string ExportsPath { get; init; } = "exports";
    public string TempPath { get; init; } = "temp";
    public string ThumbnailsPath { get; init; } = "thumbnails";
}
