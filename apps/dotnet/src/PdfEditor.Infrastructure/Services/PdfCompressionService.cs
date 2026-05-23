using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Common.Logging;

namespace PdfEditor.Infrastructure.Services;

public sealed class PdfCompressionService : IPdfCompressionService
{
    private readonly QpdfProcessService qpdfProcessService;

    public PdfCompressionService(QpdfProcessService qpdfProcessService)
    {
        this.qpdfProcessService = qpdfProcessService;
    }

    public async Task<PdfCompressionResult> CompressAsync(string sourcePath, string outputPath, string profileName, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "PDF compression service request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, OutputPath={outputPath}, ProfileName={profileName}");

        var startedOnUtc = DateTime.UtcNow;
        var arguments = BuildArguments(sourcePath, outputPath, profileName);
        var commandResult = await qpdfProcessService.RunAsync(arguments, cancellationToken);

        if (commandResult.ExitCode != 0 || !File.Exists(outputPath))
        {
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(commandResult.StandardError)
                ? "qpdf could not compress the PDF."
                : commandResult.StandardError.Trim());
        }

        var originalSize = new FileInfo(sourcePath).Length;
        var compressedSize = new FileInfo(outputPath).Length;

        var result = new PdfCompressionResult(
            originalSize,
            compressedSize,
            originalSize == 0 ? 0 : (double)(originalSize - compressedSize) / originalSize,
            DateTime.UtcNow - startedOnUtc);

        AppLogger.Info(
            message: "PDF compression service request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"OriginalSize={originalSize}, CompressedSize={compressedSize}, ProfileName={profileName}");

        return result;
    }

    private static IReadOnlyCollection<string> BuildArguments(string sourcePath, string outputPath, string profileName)
    {
        var arguments = new List<string>
        {
            "--warning-exit-0",
            sourcePath
        };

        switch (profileName)
        {
            case "HighQuality":
                arguments.AddRange(
                [
                    "--stream-data=compress",
                    "--compress-streams=y",
                    "--compression-level=5",
                    "--object-streams=generate",
                    "--linearize"
                ]);
                break;

            case "MaximumCompression":
                arguments.AddRange(
                [
                    "--stream-data=compress",
                    "--compress-streams=y",
                    "--compression-level=9",
                    "--recompress-flate",
                    "--object-streams=generate",
                    "--remove-unreferenced-resources=yes"
                ]);
                break;

            default:
                arguments.AddRange(
                [
                    "--stream-data=compress",
                    "--compress-streams=y",
                    "--compression-level=7",
                    "--recompress-flate",
                    "--object-streams=generate",
                    "--remove-unreferenced-resources=yes"
                ]);
                break;
        }

        arguments.Add(outputPath);
        return arguments;
    }
}
