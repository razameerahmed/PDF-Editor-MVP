using System.Diagnostics;
using Microsoft.Extensions.Options;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Infrastructure.Configuration;

namespace PdfEditor.Infrastructure.Services;

public sealed class QpdfProcessService
{
    private readonly string? configuredExecutablePath;

    public QpdfProcessService(IOptions<PdfToolsOptions> options)
    {
        configuredExecutablePath = options.Value.QpdfExecutablePath;
    }

    public string GetRequiredExecutablePath()
    {
        AppLogger.Debug(
            message: "qpdf executable path resolution started",
            action: "Resolve",
            result: "Started",
            updatedBy: string.Empty,
            description: "Scanning configured path and PATH environment entries for qpdf.");

        var candidates = new List<string>();

        if (!string.IsNullOrWhiteSpace(configuredExecutablePath))
        {
            candidates.Add(configuredExecutablePath);
        }

        var pathEntries = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        candidates.AddRange(pathEntries.Select(entry => Path.Combine(entry, "qpdf.exe")));

        var programFilesPath = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        if (Directory.Exists(programFilesPath))
        {
            candidates.AddRange(
                Directory.GetDirectories(programFilesPath, "qpdf *", SearchOption.TopDirectoryOnly)
                    .Select(directory => Path.Combine(directory, "bin", "qpdf.exe")));
        }

        var resolvedPath = candidates
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(File.Exists);

        if (resolvedPath is null)
        {
            AppLogger.Warn(
                message: "qpdf executable path resolution failed because qpdf was not found",
                action: "Resolve",
                result: "NotFound",
                updatedBy: string.Empty,
                description: "qpdf is not installed or not available on PATH.");

            throw new InvalidOperationException("qpdf is not installed or could not be found. Install qpdf and restart the application.");
        }

        AppLogger.Debug(
            message: "qpdf executable path resolution completed successfully",
            action: "Resolve",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ExecutablePath={resolvedPath}");

        return resolvedPath;
    }

    public async Task<QpdfCommandResult> RunAsync(IReadOnlyCollection<string> arguments, CancellationToken cancellationToken)
    {
        var executablePath = GetRequiredExecutablePath();

        AppLogger.Debug(
            message: "qpdf process execution started",
            action: "Execute",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ArgumentCount={arguments.Count}");

        var processStartInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        foreach (var argument in arguments)
        {
            processStartInfo.ArgumentList.Add(argument);
        }

        using var process = Process.Start(processStartInfo)
            ?? throw new InvalidOperationException("Unable to start qpdf.");

        var standardOutputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var standardErrorTask = process.StandardError.ReadToEndAsync(cancellationToken);

        await process.WaitForExitAsync(cancellationToken);

        var result = new QpdfCommandResult(
            process.ExitCode,
            await standardOutputTask,
            await standardErrorTask);

        if (result.ExitCode == 0)
        {
            AppLogger.Debug(
                message: "qpdf process execution completed successfully",
                action: "Execute",
                result: "Succeeded",
                updatedBy: string.Empty,
                description: $"ExitCode={result.ExitCode}");
        }
        else
        {
            AppLogger.Warn(
                message: "qpdf process execution completed with a non-zero exit code",
                action: "Execute",
                result: "Failed",
                updatedBy: string.Empty,
                description: $"ExitCode={result.ExitCode}, Error={result.StandardError}");
        }

        return result;
    }
}

public sealed record QpdfCommandResult(int ExitCode, string StandardOutput, string StandardError);
