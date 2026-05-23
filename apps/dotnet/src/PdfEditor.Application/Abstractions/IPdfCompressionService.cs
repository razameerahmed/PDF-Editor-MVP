namespace PdfEditor.Application.Abstractions;

public interface IPdfCompressionService
{
    Task<PdfCompressionResult> CompressAsync(string sourcePath, string outputPath, string profileName, CancellationToken cancellationToken);
}

public sealed record PdfCompressionResult(long OriginalSizeInBytes, long CompressedSizeInBytes, double CompressionRatio, TimeSpan Duration);
