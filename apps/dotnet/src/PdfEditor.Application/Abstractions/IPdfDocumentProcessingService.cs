using PdfEditor.Application.Models;

namespace PdfEditor.Application.Abstractions;

public interface IPdfDocumentProcessingService
{
    Task<int> GetPageCountAsync(string sourcePath, CancellationToken cancellationToken);
    Task<PdfProtectionInfo> GetProtectionInfoAsync(string sourcePath, CancellationToken cancellationToken);
    Task UnlockAsync(string sourcePath, string outputPath, string? password, CancellationToken cancellationToken);
    Task RotatePagesAsync(string sourcePath, string outputPath, IEnumerable<int> pageNumbers, int degrees, CancellationToken cancellationToken);
    Task DeletePagesAsync(string sourcePath, string outputPath, IEnumerable<int> pageNumbers, CancellationToken cancellationToken);
    Task ReorderPagesAsync(string sourcePath, string outputPath, IEnumerable<int> orderedPageNumbers, CancellationToken cancellationToken);
    Task MergeAsync(IReadOnlyCollection<string> sourcePaths, string outputPath, CancellationToken cancellationToken);
    Task<IReadOnlyCollection<string>> SplitAsync(string sourcePath, IReadOnlyCollection<string> pageRanges, string outputDirectory, CancellationToken cancellationToken);
}
