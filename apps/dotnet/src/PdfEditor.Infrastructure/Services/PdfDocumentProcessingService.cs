using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Application.Models;

namespace PdfEditor.Infrastructure.Services;

public sealed class PdfDocumentProcessingService : IPdfDocumentProcessingService
{
    private readonly QpdfProcessService qpdfProcessService;

    public PdfDocumentProcessingService(QpdfProcessService qpdfProcessService)
    {
        this.qpdfProcessService = qpdfProcessService;
    }

    public async Task<int> GetPageCountAsync(string sourcePath, CancellationToken cancellationToken)
    {
        AppLogger.Debug(
            message: "PDF page count service request received",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}");

        var commandResult = await qpdfProcessService.RunAsync(
        [
            "--warning-exit-0",
            "--show-npages",
            sourcePath
        ], cancellationToken);

        if (!int.TryParse(commandResult.StandardOutput.Trim(), out var pageCount) || pageCount < 1)
        {
            throw new InvalidOperationException("The PDF page count could not be read.");
        }

        AppLogger.Debug(
            message: "PDF page count service request completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, PageCount={pageCount}");

        return pageCount;
    }

    public async Task<PdfProtectionInfo> GetProtectionInfoAsync(string sourcePath, CancellationToken cancellationToken)
    {
        AppLogger.Debug(
            message: "PDF protection inspection service request received",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}");

        var encryptedResult = await qpdfProcessService.RunAsync(
        [
            "--warning-exit-0",
            "--is-encrypted",
            sourcePath
        ], cancellationToken);

        var isProtected = encryptedResult.ExitCode == 0;
        var requiresPassword = false;

        if (isProtected)
        {
            var passwordResult = await qpdfProcessService.RunAsync(
            [
                "--warning-exit-0",
                "--requires-password",
                sourcePath
            ], cancellationToken);

            requiresPassword = passwordResult.ExitCode == 0;
        }

        var response = new PdfProtectionInfo
        {
            IsProtected = isProtected,
            RequiresPassword = requiresPassword,
            Summary = !isProtected
                ? "This PDF is not protected."
                : requiresPassword
                    ? "This PDF is password protected and must be unlocked before editing."
                    : "This PDF has protection settings that can be removed with an unlock step."
        };

        AppLogger.Debug(
            message: "PDF protection inspection service request completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, IsProtected={response.IsProtected}, RequiresPassword={response.RequiresPassword}");

        return response;
    }

    public async Task UnlockAsync(string sourcePath, string outputPath, string? password, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "PDF unlock service request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, OutputPath={outputPath}");

        var arguments = new List<string>
        {
            "--warning-exit-0"
        };

        if (!string.IsNullOrWhiteSpace(password))
        {
            arguments.Add($"--password={password}");
        }

        arguments.Add("--decrypt");
        arguments.Add(sourcePath);
        arguments.Add(outputPath);

        var commandResult = await qpdfProcessService.RunAsync(arguments, cancellationToken);
        EnsureOutputCreated(outputPath, commandResult.StandardError);

        AppLogger.Info(
            message: "PDF unlock service request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"OutputPath={outputPath}");
    }

    public async Task RotatePagesAsync(string sourcePath, string outputPath, IEnumerable<int> pageNumbers, int degrees, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "PDF rotate pages service request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, OutputPath={outputPath}, Degrees={degrees}");

        var pageRange = BuildPageRange(pageNumbers);
        var commandResult = await qpdfProcessService.RunAsync(
        [
            "--warning-exit-0",
            sourcePath,
            outputPath,
            $"--rotate=+{degrees}:{pageRange}"
        ], cancellationToken);

        EnsureOutputCreated(outputPath, commandResult.StandardError);

        AppLogger.Info(
            message: "PDF rotate pages service request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"OutputPath={outputPath}, Degrees={degrees}");
    }

    public async Task DeletePagesAsync(string sourcePath, string outputPath, IEnumerable<int> pageNumbers, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "PDF delete pages service request received",
            action: "Delete",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, OutputPath={outputPath}");

        var pageCount = await GetPageCountAsync(sourcePath, cancellationToken);
        var pagesToDelete = pageNumbers.Distinct().OrderBy(pageNumber => pageNumber).ToHashSet();

        if (pagesToDelete.Any(pageNumber => pageNumber > pageCount))
        {
            throw new InvalidOperationException("One or more page numbers are outside the document range.");
        }

        var keptPages = Enumerable.Range(1, pageCount)
            .Where(pageNumber => !pagesToDelete.Contains(pageNumber))
            .ToArray();

        if (keptPages.Length == 0)
        {
            throw new InvalidOperationException("You must keep at least one page in the PDF.");
        }

        var commandResult = await qpdfProcessService.RunAsync(
        [
            "--warning-exit-0",
            sourcePath,
            "--pages",
            ".",
            BuildPageRange(keptPages),
            "--",
            outputPath
        ], cancellationToken);

        EnsureOutputCreated(outputPath, commandResult.StandardError);

        AppLogger.Info(
            message: "PDF delete pages service request completed successfully",
            action: "Delete",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"OutputPath={outputPath}, DeletedPageCount={pagesToDelete.Count}");
    }

    public async Task ReorderPagesAsync(string sourcePath, string outputPath, IEnumerable<int> orderedPageNumbers, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "PDF reorder pages service request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, OutputPath={outputPath}");

        var orderedPages = orderedPageNumbers.ToArray();
        var pageCount = await GetPageCountAsync(sourcePath, cancellationToken);

        if (orderedPages.Length != pageCount)
        {
            throw new InvalidOperationException("Reorder pages must include every page in the document exactly once.");
        }

        if (orderedPages.Any(pageNumber => pageNumber < 1 || pageNumber > pageCount) ||
            orderedPages.Distinct().Count() != orderedPages.Length)
        {
            throw new InvalidOperationException("Reorder pages must use each page number once and stay within the document range.");
        }

        var commandResult = await qpdfProcessService.RunAsync(
        [
            "--warning-exit-0",
            sourcePath,
            "--pages",
            ".",
            BuildPageRange(orderedPages),
            "--",
            outputPath
        ], cancellationToken);

        EnsureOutputCreated(outputPath, commandResult.StandardError);

        AppLogger.Info(
            message: "PDF reorder pages service request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"OutputPath={outputPath}, PageCount={orderedPages.Length}");
    }

    public async Task MergeAsync(IReadOnlyCollection<string> sourcePaths, string outputPath, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "PDF merge service request received",
            action: "Create",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourceCount={sourcePaths.Count}, OutputPath={outputPath}");

        if (sourcePaths.Count < 2)
        {
            throw new InvalidOperationException("Choose at least two PDF files to merge.");
        }

        var arguments = new List<string>
        {
            "--warning-exit-0",
            "--empty",
            "--pages"
        };

        foreach (var sourcePath in sourcePaths)
        {
            arguments.Add(sourcePath);
            arguments.Add("1-z");
        }

        arguments.Add("--");
        arguments.Add(outputPath);

        var commandResult = await qpdfProcessService.RunAsync(arguments, cancellationToken);
        EnsureOutputCreated(outputPath, commandResult.StandardError);

        AppLogger.Info(
            message: "PDF merge service request completed successfully",
            action: "Create",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"SourceCount={sourcePaths.Count}, OutputPath={outputPath}");
    }

    public async Task<IReadOnlyCollection<string>> SplitAsync(string sourcePath, IReadOnlyCollection<string> pageRanges, string outputDirectory, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "PDF split service request received",
            action: "Create",
            result: "Started",
            updatedBy: string.Empty,
            description: $"SourcePath={sourcePath}, RangeCount={pageRanges.Count}, OutputDirectory={outputDirectory}");

        if (pageRanges.Count == 0)
        {
            throw new InvalidOperationException("Enter at least one page range to split.");
        }

        Directory.CreateDirectory(outputDirectory);
        var outputPaths = new List<string>();
        var rangeIndex = 1;

        foreach (var pageRange in pageRanges)
        {
            var outputPath = Path.Combine(outputDirectory, $"split-{rangeIndex:D2}.pdf");
            var commandResult = await qpdfProcessService.RunAsync(
            [
                "--warning-exit-0",
                sourcePath,
                "--pages",
                ".",
                pageRange,
                "--",
                outputPath
            ], cancellationToken);

            EnsureOutputCreated(outputPath, commandResult.StandardError);
            outputPaths.Add(outputPath);
            rangeIndex++;
        }

        AppLogger.Info(
            message: "PDF split service request completed successfully",
            action: "Create",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"OutputCount={outputPaths.Count}, OutputDirectory={outputDirectory}");

        return outputPaths;
    }

    private static string BuildPageRange(IEnumerable<int> pageNumbers) =>
        string.Join(",", pageNumbers);

    private static void EnsureOutputCreated(string outputPath, string standardError)
    {
        if (!File.Exists(outputPath))
        {
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(standardError)
                ? "qpdf could not create the requested PDF output."
                : standardError.Trim());
        }
    }
}
