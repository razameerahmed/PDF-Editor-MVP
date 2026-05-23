namespace PdfEditor.Application.Abstractions;

public interface IFileStorageService
{
    Task<string> CreateWritableFilePathAsync(string containerName, string originalFileName, CancellationToken cancellationToken);
    Task<string> SaveFileAsync(Stream sourceStream, string containerName, string originalFileName, CancellationToken cancellationToken);
    Task<Stream> ReadFileAsync(string storagePath, CancellationToken cancellationToken);
    Task DeleteFileAsync(string storagePath, CancellationToken cancellationToken);
    Task MoveFileAsync(string sourcePath, string destinationPath, CancellationToken cancellationToken);
    Task CopyFileAsync(string sourcePath, string destinationPath, CancellationToken cancellationToken);
    Task<bool> FileExistsAsync(string storagePath, CancellationToken cancellationToken);
}
