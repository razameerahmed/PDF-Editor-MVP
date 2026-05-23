using Microsoft.Extensions.Options;
using Microsoft.Extensions.Hosting;
using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Infrastructure.Configuration;

namespace PdfEditor.Infrastructure.Services;

public sealed class LocalFileStorageService : IFileStorageService
{
    private readonly string rootPath;

    public LocalFileStorageService(IOptions<StorageOptions> options, IHostEnvironment hostEnvironment)
    {
        rootPath = ResolveRootPath(options.Value.RootPath, hostEnvironment.ContentRootPath);
        Directory.CreateDirectory(rootPath);
    }

    public Task<string> CreateWritableFilePathAsync(string containerName, string originalFileName, CancellationToken cancellationToken)
    {
        var safeContainer = containerName.Trim().ToLowerInvariant();
        var containerPath = Path.Combine(rootPath, safeContainer);
        Directory.CreateDirectory(containerPath);

        var fileExtension = Path.GetExtension(originalFileName);
        var storedFileName = $"{Guid.NewGuid():N}{fileExtension}";
        var fullPath = Path.Combine(containerPath, storedFileName);

        AppLogger.Debug(
            message: "Storage writable file path created",
            action: "Create",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"Container={safeContainer}, Path={fullPath}");

        return Task.FromResult(fullPath);
    }

    public async Task<string> SaveFileAsync(Stream sourceStream, string containerName, string originalFileName, CancellationToken cancellationToken)
    {
        try
        {
            var fullPath = await CreateWritableFilePathAsync(containerName, originalFileName, cancellationToken);
            await using var destination = File.Create(fullPath);
            sourceStream.Position = 0;
            await sourceStream.CopyToAsync(destination, cancellationToken);

            AppLogger.Info(
                message: "Storage save file request completed successfully",
                action: "Create",
                result: "Succeeded",
                updatedBy: string.Empty,
                description: $"Container={containerName}, Path={fullPath}, Bytes={sourceStream.Length}");

            return fullPath;
        }
        catch (Exception exception)
        {
            AppLogger.Error(
                message: "Storage save file request failed with unexpected exception",
                action: "Create",
                result: "Failed",
                updatedBy: string.Empty,
                description: $"Container={containerName}, OriginalFileName={originalFileName}",
                exception: exception);

            throw new InvalidOperationException("The PDF file could not be saved to local storage.", exception);
        }
    }

    public Task<Stream> ReadFileAsync(string storagePath, CancellationToken cancellationToken) =>
        Task.FromResult<Stream>(File.OpenRead(storagePath));

    public Task DeleteFileAsync(string storagePath, CancellationToken cancellationToken)
    {
        if (File.Exists(storagePath))
        {
            File.Delete(storagePath);
        }

        return Task.CompletedTask;
    }

    public Task MoveFileAsync(string sourcePath, string destinationPath, CancellationToken cancellationToken)
    {
        File.Move(sourcePath, destinationPath, true);
        return Task.CompletedTask;
    }

    public Task CopyFileAsync(string sourcePath, string destinationPath, CancellationToken cancellationToken)
    {
        File.Copy(sourcePath, destinationPath, true);
        return Task.CompletedTask;
    }

    public Task<bool> FileExistsAsync(string storagePath, CancellationToken cancellationToken) =>
        Task.FromResult(File.Exists(storagePath));

    private static string ResolveRootPath(string configuredRootPath, string contentRootPath)
    {
        if (Path.IsPathRooted(configuredRootPath))
        {
            return configuredRootPath;
        }

        var currentDirectory = new DirectoryInfo(contentRootPath);
        while (currentDirectory is not null)
        {
            var appsDirectory = Path.Combine(currentDirectory.FullName, "apps");
            var environmentFile = Path.Combine(currentDirectory.FullName, ".env.example");
            if (Directory.Exists(appsDirectory) || File.Exists(environmentFile))
            {
                return Path.GetFullPath(Path.Combine(currentDirectory.FullName, configuredRootPath));
            }

            currentDirectory = currentDirectory.Parent;
        }

        return Path.GetFullPath(Path.Combine(contentRootPath, configuredRootPath));
    }
}
