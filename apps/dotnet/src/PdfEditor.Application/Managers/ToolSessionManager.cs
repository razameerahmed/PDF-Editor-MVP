using System.Text.Json;
using System.Text.Json.Nodes;
using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Application.Models;
using PdfEditor.Contracts.Documents;

namespace PdfEditor.Application.Managers;

public sealed class ToolSessionManager
{
    private static readonly string[] SupportedAnnotationTypes = ["Text", "Highlight", "Rectangle", "Freehand", "Image", "Link"];

    private readonly ITemporaryPdfSessionService temporaryPdfSessionService;
    private readonly IDocumentEngineService documentEngineService;
    private readonly IPdfCompressionService pdfCompressionService;
    private readonly IPdfDocumentProcessingService pdfDocumentProcessingService;
    private readonly IPdfTextEditingService pdfTextEditingService;
    private readonly IFileStorageService fileStorageService;
    private readonly IUserContextAccessor userContextAccessor;
    private readonly DocumentManager documentManager;
    private readonly DocumentAnnotationManager documentAnnotationManager;

    public ToolSessionManager(
        ITemporaryPdfSessionService temporaryPdfSessionService,
        IDocumentEngineService documentEngineService,
        IPdfCompressionService pdfCompressionService,
        IPdfDocumentProcessingService pdfDocumentProcessingService,
        IPdfTextEditingService pdfTextEditingService,
        IFileStorageService fileStorageService,
        IUserContextAccessor userContextAccessor,
        DocumentManager documentManager,
        DocumentAnnotationManager documentAnnotationManager)
    {
        this.temporaryPdfSessionService = temporaryPdfSessionService;
        this.documentEngineService = documentEngineService;
        this.pdfCompressionService = pdfCompressionService;
        this.pdfDocumentProcessingService = pdfDocumentProcessingService;
        this.pdfTextEditingService = pdfTextEditingService;
        this.fileStorageService = fileStorageService;
        this.userContextAccessor = userContextAccessor;
        this.documentManager = documentManager;
        this.documentAnnotationManager = documentAnnotationManager;
    }

    public async Task<ToolSessionResponse> CreateAsync(CreateToolSessionRequest request, string originalFileName, Stream fileStream, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session create manager request received",
            action: "Create",
            result: "Started",
            updatedBy: string.Empty,
            description: $"OriginalFileName={originalFileName}, Title={request.Title}");

        ValidatePdfUpload(originalFileName, fileStream.Length);

        var title = string.IsNullOrWhiteSpace(request.Title)
            ? Path.GetFileNameWithoutExtension(originalFileName)
            : request.Title.Trim();

        var session = await temporaryPdfSessionService.CreateAsync(title, originalFileName, fileStream, cancellationToken);
        var response = await MapSessionAsync(session, cancellationToken);

        AppLogger.Info(
            message: "Tool session create manager request completed successfully",
            action: "Create",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={response.ToolSessionId}, Title={response.Title}");

        return response;
    }

    public async Task<ToolSessionResponse> CreateMergedAsync(
        CreateMergeToolSessionRequest request,
        IReadOnlyCollection<ToolSessionUploadFile> files,
        CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session merge manager request received",
            action: "Create",
            result: "Started",
            updatedBy: string.Empty,
            description: $"FileCount={files.Count}, Title={request.Title}");

        if (files.Count < 2)
        {
            throw new InvalidOperationException("Choose at least two PDF files to merge.");
        }

        var stagedPaths = new List<string>();

        try
        {
            foreach (var file in files)
            {
                ValidatePdfUpload(file.OriginalFileName, file.FileStream.Length);
                var stagedPath = await fileStorageService.SaveFileAsync(file.FileStream, "temp", file.OriginalFileName, cancellationToken);
                stagedPaths.Add(stagedPath);
            }

            var outputPath = await fileStorageService.CreateWritableFilePathAsync("temp", "merged.pdf", cancellationToken);
            await pdfDocumentProcessingService.MergeAsync(stagedPaths, outputPath, cancellationToken);

            var title = string.IsNullOrWhiteSpace(request.Title)
                ? "Merged PDF"
                : request.Title.Trim();

            var session = await temporaryPdfSessionService.CreateFromStoragePathAsync(
                title,
                "merged.pdf",
                outputPath,
                cancellationToken);

            var response = await MapSessionAsync(session, cancellationToken);

            AppLogger.Info(
                message: "Tool session merge manager request completed successfully",
                action: "Create",
                result: "Succeeded",
                updatedBy: string.Empty,
                description: $"ToolSessionId={response.ToolSessionId}, PageCount={response.PageCount}");

            return response;
        }
        finally
        {
            foreach (var stagedPath in stagedPaths)
            {
                await fileStorageService.DeleteFileAsync(stagedPath, cancellationToken);
            }
        }
    }

    public async Task<ToolSessionResponse> GetAsync(Guid toolSessionId, CancellationToken cancellationToken)
    {
        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        return await MapSessionAsync(session, cancellationToken);
    }

    public async Task<DocumentDownloadDto> DownloadAsync(Guid toolSessionId, bool includePendingTextChanges, CancellationToken cancellationToken)
    {
        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        var contentPath = includePendingTextChanges
            ? await GetMaterializedSessionContentPathAsync(session, cancellationToken)
            : session.CurrentStoragePath;
        return new DocumentDownloadDto
        {
            FileName = session.OriginalFileName,
            MimeType = session.MimeType,
            ContentStream = await fileStorageService.ReadFileAsync(contentPath, cancellationToken)
        };
    }

    public async Task<DocumentDownloadDto> DownloadSplitArtifactAsync(Guid toolSessionId, Guid toolSessionSplitArtifactId, CancellationToken cancellationToken)
    {
        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        var splitArtifact = session.SplitArtifacts.FirstOrDefault(artifact => artifact.ToolSessionSplitArtifactId == toolSessionSplitArtifactId)
            ?? throw new KeyNotFoundException("The split PDF file could not be found. Run the split again and continue.");

        return new DocumentDownloadDto
        {
            FileName = splitArtifact.FileName,
            MimeType = "application/pdf",
            ContentStream = await fileStorageService.ReadFileAsync(splitArtifact.StoragePath, cancellationToken)
        };
    }

    public async Task<ToolSessionResponse> AddAttachmentAsync(Guid toolSessionId, string originalFileName, string mimeType, Stream fileStream, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session attachment add manager request received",
            action: "Create",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, FileName={originalFileName}");

        if (string.IsNullOrWhiteSpace(originalFileName))
        {
            throw new InvalidOperationException("Choose a file before adding a document attachment.");
        }

        if (fileStream.Length == 0)
        {
            throw new InvalidOperationException("The attachment file is empty. Choose a real file and try again.");
        }

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        var storagePath = await fileStorageService.SaveFileAsync(fileStream, "temp", originalFileName, cancellationToken);
        var fileInfo = new FileInfo(storagePath);
        var attachment = new TemporaryPdfAttachment
        {
            ToolSessionAttachmentId = Guid.NewGuid(),
            AttachmentType = "File",
            FileName = Path.GetFileName(originalFileName),
            MimeType = string.IsNullOrWhiteSpace(mimeType) ? "application/octet-stream" : mimeType,
            StoragePath = storagePath,
            FileSizeInBytes = fileInfo.Length,
            CreatedOnUtc = DateTime.UtcNow
        };

        session = await temporaryPdfSessionService.AddAttachmentAsync(
            toolSessionId,
            attachment,
            "Add Attachment",
            $"Added the file attachment '{attachment.FileName}'.",
            cancellationToken);

        var response = await MapSessionAsync(session, cancellationToken);

        AppLogger.Info(
            message: "Tool session attachment add manager request completed successfully",
            action: "Create",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, ToolSessionAttachmentId={attachment.ToolSessionAttachmentId}");

        return response;
    }

    public async Task<DocumentDownloadDto> DownloadAttachmentAsync(Guid toolSessionId, Guid toolSessionAttachmentId, CancellationToken cancellationToken)
    {
        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        var attachment = session.Attachments.FirstOrDefault(currentAttachment => currentAttachment.ToolSessionAttachmentId == toolSessionAttachmentId)
            ?? throw new KeyNotFoundException("The file attachment could not be found. Add it again and continue.");

        return new DocumentDownloadDto
        {
            FileName = attachment.FileName,
            MimeType = attachment.MimeType,
            ContentStream = await fileStorageService.ReadFileAsync(attachment.StoragePath, cancellationToken)
        };
    }

    public async Task<ToolSessionResponse> RemoveAttachmentAsync(Guid toolSessionId, Guid toolSessionAttachmentId, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session attachment remove manager request received",
            action: "Delete",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, ToolSessionAttachmentId={toolSessionAttachmentId}");

        var session = await temporaryPdfSessionService.RemoveAttachmentAsync(
            toolSessionId,
            toolSessionAttachmentId,
            "Remove Attachment",
            "Removed a file attachment from the editor workspace.",
            cancellationToken);

        var response = await MapSessionAsync(session, cancellationToken);

        AppLogger.Info(
            message: "Tool session attachment remove manager request completed successfully",
            action: "Delete",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, ToolSessionAttachmentId={toolSessionAttachmentId}");

        return response;
    }

    public async Task<ToolSessionCompressionResponse> CompressAsync(Guid toolSessionId, CompressDocumentRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session compression manager request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, CompressionProfile={request.CompressionProfile}");

        if (!new[] { "HighQuality", "Balanced", "MaximumCompression" }.Contains(request.CompressionProfile, StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Choose HighQuality, Balanced, or MaximumCompression.");
        }

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        var compressionSourcePath = await GetMaterializedSessionContentPathAsync(session, cancellationToken);
        var outputPath = await fileStorageService.CreateWritableFilePathAsync("temp", session.OriginalFileName, cancellationToken);
        var compressionResult = await pdfCompressionService.CompressAsync(compressionSourcePath, outputPath, request.CompressionProfile, cancellationToken);

        session = await temporaryPdfSessionService.UpdateCurrentFileAsync(
            toolSessionId,
            outputPath,
            "Compress PDF",
            $"Compressed the PDF using the {request.CompressionProfile} profile.",
            session.Annotations,
            cancellationToken);

        var response = new ToolSessionCompressionResponse
        {
            Session = await MapSessionAsync(session, cancellationToken),
            CompressionProfile = request.CompressionProfile,
            OriginalSizeInBytes = compressionResult.OriginalSizeInBytes,
            CompressedSizeInBytes = compressionResult.CompressedSizeInBytes,
            CompressionRatio = compressionResult.CompressionRatio,
            ProcessingDurationMilliseconds = (long)compressionResult.Duration.TotalMilliseconds
        };

        AppLogger.Info(
            message: "Tool session compression manager request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, FileSizeInBytes={response.Session.FileSizeInBytes}");

        return response;
    }

    public async Task<ToolSessionResponse> RotatePagesAsync(Guid toolSessionId, RotatePagesRequest request, CancellationToken cancellationToken)
    {
        if (request.PageNumbers.Count == 0)
        {
            throw new InvalidOperationException("Enter at least one page number to rotate.");
        }

        if (request.Degrees is not (90 or 180 or 270))
        {
            throw new InvalidOperationException("Rotation must be 90, 180, or 270 degrees.");
        }

        return await RunPageOperationAsync(
            toolSessionId,
            "Rotate Pages",
            $"Rotated {request.PageNumbers.Count} page(s) by {request.Degrees} degrees.",
            (sourcePath, outputPath, token) => pdfDocumentProcessingService.RotatePagesAsync(sourcePath, outputPath, request.PageNumbers, request.Degrees, token),
            annotations => RotateAnnotations(annotations, request.PageNumbers, request.Degrees),
            cancellationToken);
    }

    public async Task<ToolSessionResponse> DeletePagesAsync(Guid toolSessionId, DeletePagesRequest request, CancellationToken cancellationToken)
    {
        if (request.PageNumbers.Count == 0)
        {
            throw new InvalidOperationException("Enter at least one page number to delete.");
        }

        return await RunPageOperationAsync(
            toolSessionId,
            "Delete Pages",
            $"Deleted {request.PageNumbers.Count} page(s) from the PDF.",
            (sourcePath, outputPath, token) => pdfDocumentProcessingService.DeletePagesAsync(sourcePath, outputPath, request.PageNumbers, token),
            annotations => DeleteAnnotations(annotations, request.PageNumbers),
            cancellationToken);
    }

    public async Task<ToolSessionResponse> ReorderPagesAsync(Guid toolSessionId, ReorderPagesRequest request, CancellationToken cancellationToken)
    {
        if (request.OrderedPageNumbers.Count == 0)
        {
            throw new InvalidOperationException("Enter the full page order before reordering.");
        }

        return await RunPageOperationAsync(
            toolSessionId,
            "Reorder Pages",
            "Reordered the pages in the PDF.",
            (sourcePath, outputPath, token) => pdfDocumentProcessingService.ReorderPagesAsync(sourcePath, outputPath, request.OrderedPageNumbers, token),
            annotations => ReorderAnnotations(annotations, request.OrderedPageNumbers),
            cancellationToken);
    }

    public async Task<ToolSessionResponse> SaveAnnotationsAsync(Guid toolSessionId, SaveToolSessionAnnotationsRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session annotation state manager request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, AnnotationCount={request.Annotations.Count}");

        var normalizedAnnotations = NormalizeAnnotations(request.Annotations);
        var session = await temporaryPdfSessionService.UpdateAnnotationsAsync(
            toolSessionId,
            normalizedAnnotations,
            "Save Annotations",
            normalizedAnnotations.Count == 0
                ? "Cleared annotation state from the editor."
                : $"Saved {normalizedAnnotations.Count} annotation(s) in the editor.",
            cancellationToken);

        var response = await MapSessionAsync(session, cancellationToken);

        AppLogger.Info(
            message: "Tool session annotation state manager request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, AnnotationCount={response.Annotations.Count}");

        return response;
    }

    public async Task<GetToolSessionDetectedTextResponse> GetDetectedTextAsync(Guid toolSessionId, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session detected text manager request received",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}");

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        session = await EnsureSessionTextObjectsAsync(session, cancellationToken);

        var response = new GetToolSessionDetectedTextResponse
        {
            ToolSessionId = toolSessionId,
            TextBlocks = session.TextObjects
                .OrderBy(textBlock => textBlock.PageNumber)
                .ThenBy(textBlock => textBlock.Y)
                .ThenBy(textBlock => textBlock.X)
                .Select(MapTextObject)
                .ToArray()
        };

        AppLogger.Info(
            message: "Tool session detected text manager request completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, TextBlockCount={response.TextBlocks.Count}");

        return response;
    }

    public async Task<GetToolSessionDocumentSnapshotResponse> GetDocumentSnapshotAsync(Guid toolSessionId, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session document snapshot manager request received",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}");

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        session = await EnsureSessionTextObjectsAsync(session, cancellationToken);
        var snapshot = await documentEngineService.GetDocumentSnapshotAsync(session.CurrentStoragePath, cancellationToken);

        var response = new GetToolSessionDocumentSnapshotResponse
        {
            ToolSessionId = toolSessionId,
            DocumentFingerprintSha256 = snapshot.DocumentFingerprintSha256,
            PageCount = snapshot.PageCount,
            Pages = snapshot.Pages
                .OrderBy(page => page.PageNumber)
                .Select(page => new ToolSessionDocumentPageDto
                {
                    PageNumber = page.PageNumber,
                    Width = page.Width,
                    Height = page.Height,
                    Rotation = page.Rotation
                })
                .ToArray(),
            TextBlocks = session.TextObjects
                .OrderBy(textBlock => textBlock.PageNumber)
                .ThenBy(textBlock => textBlock.Y)
                .ThenBy(textBlock => textBlock.X)
                .Select(MapTextObject)
                .ToArray(),
            Capabilities = snapshot.Capabilities
                .OrderBy(capability => capability.CapabilityName)
                .Select(capability => new ToolSessionDocumentEngineCapabilityDto
                {
                    CapabilityName = capability.CapabilityName,
                    IsAvailable = capability.IsAvailable,
                    Description = capability.Description
                })
                .ToArray()
        };

        AppLogger.Info(
            message: "Tool session document snapshot manager request completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, PageCount={response.PageCount}, TextBlockCount={response.TextBlocks.Count}");

        return response;
    }

    public async Task<ToolSessionResponse> RunOcrAsync(Guid toolSessionId, RunToolSessionOcrRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session OCR manager request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, LanguageCode={request.LanguageCode}, PageRange={request.PageRange}, Deskew={request.Deskew}, ForceOcr={request.ForceOcr}");

        var normalizedLanguageCode = string.IsNullOrWhiteSpace(request.LanguageCode)
            ? "eng"
            : request.LanguageCode.Trim();
        var normalizedPageRange = string.IsNullOrWhiteSpace(request.PageRange)
            ? null
            : request.PageRange.Trim();

        if (normalizedLanguageCode.Length < 2)
        {
            throw new InvalidOperationException("Enter a valid OCR language code like eng or eng+urd.");
        }

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        var ocrSourcePath = await GetMaterializedSessionContentPathAsync(session, cancellationToken);
        var protectionInfo = await pdfDocumentProcessingService.GetProtectionInfoAsync(ocrSourcePath, cancellationToken);
        if (protectionInfo.RequiresPassword)
        {
            throw new InvalidOperationException("Unlock the protected PDF before running OCR.");
        }

        var outputPath = await fileStorageService.CreateWritableFilePathAsync("temp", session.OriginalFileName, cancellationToken);
        var ocrResult = await pdfTextEditingService.RunOcrAsync(
            ocrSourcePath,
            outputPath,
            normalizedLanguageCode,
            normalizedPageRange,
            request.Deskew,
            request.ForceOcr,
            cancellationToken);

        session = await temporaryPdfSessionService.UpdateCurrentFileAsync(
            toolSessionId,
            outputPath,
            "OCR PDF",
            BuildOcrSummary(ocrResult),
            session.Annotations,
            cancellationToken);

        var snapshot = await documentEngineService.GetDocumentSnapshotAsync(session.CurrentStoragePath, cancellationToken);
        await SynchronizeSessionTextObjectsAsync(session, snapshot.TextBlocks, cancellationToken);
        session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        var response = await MapSessionAsync(session, cancellationToken);

        AppLogger.Info(
            message: "Tool session OCR manager request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, LanguageCode={ocrResult.LanguageCode}, PageRange={ocrResult.PageRange}, PageCount={response.PageCount}");

        return response;
    }

    public async Task<ToolSessionTextOperationResponse> ReplaceTextAsync(Guid toolSessionId, ReplaceToolSessionTextRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session text replace manager request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, TextBlockId={request.TextBlockId}");

        if (string.IsNullOrWhiteSpace(request.TextObjectId) && string.IsNullOrWhiteSpace(request.TextBlockId))
        {
            throw new InvalidOperationException("Select detected PDF text before applying a text change.");
        }

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        session = await EnsureSessionTextObjectsAsync(session, cancellationToken);
        var sourceTextObject = ResolveTextObject(session, request.TextObjectId, request.TextBlockId);
        var updatedTextObject = ApplyRequestedTextStyle(
            CreateUpdatedOverlayTextObject(sourceTextObject, NormalizeReplacementTextForEditing(request.ReplacementText)),
            request.FontName,
            request.FontSize,
            request.ColorHex,
            request.IsBold,
            request.IsItalic);
        var previewResult = await pdfTextEditingService.PreviewTextLayoutAsync(
            session.CurrentStoragePath,
            sourceTextObject.SourceTextBlockId,
            updatedTextObject.Text,
            updatedTextObject.X,
            updatedTextObject.Y,
            updatedTextObject.Width,
            updatedTextObject.Height,
            updatedTextObject.FontName,
            updatedTextObject.FontSize,
            updatedTextObject.ColorHex,
            updatedTextObject.IsBold,
            updatedTextObject.IsItalic,
            cancellationToken);
        updatedTextObject = ApplyPreviewLayout(updatedTextObject, previewResult.ResultTextBlock);
        session = await ReplaceSessionTextObjectAsync(
            session,
            updatedTextObject,
            "Edit Text",
            string.IsNullOrWhiteSpace(updatedTextObject.Text)
                ? $"Removed detected text on page {updatedTextObject.PageNumber}."
                : $"Updated detected text on page {updatedTextObject.PageNumber}.",
            cancellationToken);

        var response = new ToolSessionTextOperationResponse
        {
            Session = await MapSessionAsync(session, cancellationToken),
            Operation = new ToolSessionTextOperationDto
            {
                OperationType = "ReplaceText",
                SourceTextObjectId = sourceTextObject.ToolSessionTextObjectId.ToString(),
                SourceTextBlockId = sourceTextObject.SourceTextBlockId,
                ResultTextBlock = MapTextObject(updatedTextObject),
                PageNumber = updatedTextObject.PageNumber,
                OriginalText = sourceTextObject.Text,
                Text = updatedTextObject.Text,
                KeepOriginal = false
            }
        };

        AppLogger.Info(
            message: "Tool session text replace manager request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, TextBlockId={sourceTextObject.SourceTextBlockId}, PageNumber={updatedTextObject.PageNumber}");

        return response;
    }

    public async Task<ToolSessionTextOperationResponse> UpdateTextLayoutAsync(Guid toolSessionId, UpdateToolSessionTextLayoutRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session text layout manager request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, TextBlockId={request.TextBlockId}, KeepOriginal={request.KeepOriginal}");

        if (string.IsNullOrWhiteSpace(request.TextObjectId) && string.IsNullOrWhiteSpace(request.TextBlockId))
        {
            throw new InvalidOperationException("Select detected PDF text before moving or duplicating it.");
        }

        if (request.Width <= 0 || request.Height <= 0)
        {
            throw new InvalidOperationException("The selected text area is too small to place text there.");
        }

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        session = await EnsureSessionTextObjectsAsync(session, cancellationToken);
        var sourceTextObject = ResolveTextObject(session, request.TextObjectId, request.TextBlockId);
        var updatedTextObject = ApplyRequestedTextStyle(
            request.KeepOriginal
                ? CreateDuplicatedOverlayTextObject(sourceTextObject, NormalizeReplacementTextForEditing(request.Text), request.X, request.Y, request.Width, request.Height)
                : CreateMovedOverlayTextObject(sourceTextObject, NormalizeReplacementTextForEditing(request.Text), request.X, request.Y, request.Width, request.Height),
            request.FontName,
            request.FontSize,
            request.ColorHex,
            request.IsBold,
            request.IsItalic);
        var shouldPreserveCurrentLayout = ShouldPreserveCurrentTextObjectLayout(sourceTextObject, updatedTextObject);
        if (shouldPreserveCurrentLayout && ShouldUsePreservedSourcePreviewMode(sourceTextObject, updatedTextObject))
        {
            updatedTextObject = ApplyPreservedSourceLayout(updatedTextObject, sourceTextObject);
        }
        else if (!shouldPreserveCurrentLayout)
        {
            var previewResult = await pdfTextEditingService.PreviewTextLayoutAsync(
                session.CurrentStoragePath,
                sourceTextObject.SourceTextBlockId,
                updatedTextObject.Text,
                updatedTextObject.X,
                updatedTextObject.Y,
                updatedTextObject.Width,
                updatedTextObject.Height,
                updatedTextObject.FontName,
                updatedTextObject.FontSize,
                updatedTextObject.ColorHex,
                updatedTextObject.IsBold,
                updatedTextObject.IsItalic,
                cancellationToken);
            updatedTextObject = ApplyPreviewLayout(updatedTextObject, previewResult.ResultTextBlock);
        }

        session = request.KeepOriginal
            ? await AppendSessionTextObjectAsync(
                session,
                updatedTextObject,
                "Duplicate Text",
                $"Duplicated detected text on page {updatedTextObject.PageNumber}.",
                cancellationToken)
            : await ReplaceSessionTextObjectAsync(
                session,
                updatedTextObject,
                "Move Text",
                $"Moved detected text on page {updatedTextObject.PageNumber}.",
                cancellationToken);

        var response = new ToolSessionTextOperationResponse
        {
            Session = await MapSessionAsync(session, cancellationToken),
            Operation = new ToolSessionTextOperationDto
            {
                OperationType = request.KeepOriginal ? "DuplicateText" : "MoveText",
                SourceTextObjectId = sourceTextObject.ToolSessionTextObjectId.ToString(),
                SourceTextBlockId = sourceTextObject.SourceTextBlockId,
                ResultTextBlock = MapTextObject(updatedTextObject),
                PageNumber = updatedTextObject.PageNumber,
                OriginalText = string.Empty,
                Text = updatedTextObject.Text,
                KeepOriginal = request.KeepOriginal
            }
        };

        AppLogger.Info(
            message: "Tool session text layout manager request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, TextBlockId={request.TextBlockId}, KeepOriginal={request.KeepOriginal}");

        return response;
    }

    public async Task<GetToolSessionFontResourceResponse> GetFontResourceAsync(Guid toolSessionId, GetToolSessionFontResourceRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Debug(
            message: "Tool session font resource manager request received",
            action: "View",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, TextObjectId={request.TextObjectId}, TextBlockId={request.TextBlockId}, FontName={request.FontName}, IsBold={request.IsBold}, IsItalic={request.IsItalic}");

        if (string.IsNullOrWhiteSpace(request.TextObjectId) && string.IsNullOrWhiteSpace(request.TextBlockId))
        {
            throw new InvalidOperationException("Select detected PDF text before loading its font resource.");
        }

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        session = await EnsureSessionTextObjectsAsync(session, cancellationToken);
        var sourceTextObject = ResolveTextObject(session, request.TextObjectId, request.TextBlockId);
        var resolvedFontName = string.IsNullOrWhiteSpace(request.FontName)
            ? (sourceTextObject.FontName ?? sourceTextObject.SourceFontName ?? string.Empty).Trim()
            : request.FontName.Trim();

        if (string.IsNullOrWhiteSpace(resolvedFontName))
        {
            throw new InvalidOperationException("The selected PDF text does not expose a font that can be previewed yet.");
        }

        var fontResource = await pdfTextEditingService.ResolveFontResourceAsync(
            session.CurrentStoragePath,
            sourceTextObject.SourceTextBlockId,
            resolvedFontName,
            request.IsBold ?? sourceTextObject.IsBold,
            request.IsItalic ?? sourceTextObject.IsItalic,
            cancellationToken);

        AppLogger.Debug(
            message: "Tool session font resource manager request completed successfully",
            action: "View",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, SourceTextBlockId={sourceTextObject.SourceTextBlockId}, RequestedFontName={fontResource.RequestedFontName}, ResolvedFontName={fontResource.ResolvedFontName}, FontSource={fontResource.FontSource}, IsFallback={fontResource.IsFallback}");

        return MapFontResource(fontResource);
    }

    public async Task<GetToolSessionDetectedTextResponse> UndoTextOperationAsync(Guid toolSessionId, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session text undo manager request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}");

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        session = await EnsureSessionTextObjectsAsync(session, cancellationToken);
        var historyEntry = session.TextObjectUndoStack
            .OrderByDescending(entry => entry.CreatedOnUtc)
            .FirstOrDefault()
            ?? throw new InvalidOperationException("There is no PDF text edit to undo yet.");

        session.TextObjectUndoStack = session.TextObjectUndoStack
            .Where(entry => entry.HistoryEntryId != historyEntry.HistoryEntryId)
            .ToArray();

        session = await temporaryPdfSessionService.UpdateTextObjectsAsync(
            toolSessionId,
            CloneTextObjects(historyEntry.TextObjects),
            "Undo Text",
            "Undid the last PDF text edit.",
            cancellationToken);

        var response = new GetToolSessionDetectedTextResponse
        {
            ToolSessionId = toolSessionId,
            TextBlocks = session.TextObjects
                .OrderBy(textBlock => textBlock.PageNumber)
                .ThenBy(textBlock => textBlock.Y)
                .ThenBy(textBlock => textBlock.X)
                .Select(MapTextObject)
                .ToArray()
        };

        AppLogger.Info(
            message: "Tool session text undo manager request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, RestoredTextObjectCount={response.TextBlocks.Count}");

        return response;
    }

    public async Task<ToolSessionResponse> UnlockAsync(Guid toolSessionId, UnlockToolSessionRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session unlock manager request received",
            action: "Update",
            result: "Started",
            updatedBy: userContextAccessor.GetRequiredEmailAddress(),
            description: $"ToolSessionId={toolSessionId}");

        if (!userContextAccessor.IsPaidSubscriber())
        {
            throw new InvalidOperationException("Unlock PDF is available for paid users only.");
        }

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        var unlockSourcePath = await GetMaterializedSessionContentPathAsync(session, cancellationToken);
        var protectionInfo = await pdfDocumentProcessingService.GetProtectionInfoAsync(unlockSourcePath, cancellationToken);
        if (!protectionInfo.IsProtected)
        {
            throw new InvalidOperationException("This PDF is not protected.");
        }

        var outputPath = await fileStorageService.CreateWritableFilePathAsync("temp", session.OriginalFileName, cancellationToken);
        await pdfDocumentProcessingService.UnlockAsync(unlockSourcePath, outputPath, request.Password?.Trim(), cancellationToken);

        session = await temporaryPdfSessionService.UpdateCurrentFileAsync(
            toolSessionId,
            outputPath,
            "Unlock PDF",
            "Unlocked the PDF for editing in the editor workspace.",
            session.Annotations,
            cancellationToken);

        var response = await MapSessionAsync(session, cancellationToken);

        AppLogger.Info(
            message: "Tool session unlock manager request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: userContextAccessor.GetRequiredEmailAddress(),
            description: $"ToolSessionId={toolSessionId}");

        return response;
    }

    public async Task<ToolSessionResponse> SplitAsync(Guid toolSessionId, SplitToolSessionRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session split manager request received",
            action: "Create",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, RangeCount={request.PageRanges.Count}");

        var normalizedRanges = NormalizePageRanges(request.PageRanges);
        if (normalizedRanges.Count == 0)
        {
            throw new InvalidOperationException("Enter at least one page range to split.");
        }

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        var splitSourcePath = await GetMaterializedSessionContentPathAsync(session, cancellationToken);
        var outputDirectory = Path.Combine(Path.GetDirectoryName(splitSourcePath)!, $"{Guid.NewGuid():N}-split");
        var outputPaths = await pdfDocumentProcessingService.SplitAsync(splitSourcePath, normalizedRanges, outputDirectory, cancellationToken);

        var baseFileName = Path.GetFileNameWithoutExtension(session.OriginalFileName);
        var splitArtifacts = outputPaths
            .Select((outputPath, index) => new TemporaryPdfSplitArtifact
            {
                ToolSessionSplitArtifactId = Guid.NewGuid(),
                PageRange = normalizedRanges.ElementAt(index),
                FileName = $"{baseFileName}-part-{index + 1:D2}.pdf",
                StoragePath = outputPath,
                FileSizeInBytes = new FileInfo(outputPath).Length,
                CreatedOnUtc = DateTime.UtcNow
            })
            .ToArray();

        session = await temporaryPdfSessionService.UpdateSplitArtifactsAsync(
            toolSessionId,
            splitArtifacts,
            "Split PDF",
            $"Split the PDF into {splitArtifacts.Length} file(s).",
            cancellationToken);

        var response = await MapSessionAsync(session, cancellationToken);

        AppLogger.Info(
            message: "Tool session split manager request completed successfully",
            action: "Create",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, SplitArtifactCount={response.SplitArtifacts.Count}");

        return response;
    }

    public async Task<SaveToolSessionResponse> SaveAsync(Guid toolSessionId, SaveToolSessionRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session save manager request received",
            action: "Create",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, Title={request.Title}");

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        var saveSourcePath = await GetMaterializedSessionContentPathAsync(session, cancellationToken);
        await using var stream = await fileStorageService.ReadFileAsync(saveSourcePath, cancellationToken);

        var title = string.IsNullOrWhiteSpace(request.Title)
            ? session.Title
            : request.Title.Trim();

        var document = await documentManager.UploadAsync(
            new CreateDocumentRequest
            {
                Title = title
            },
            session.OriginalFileName,
            stream,
            cancellationToken);

        var savedAnnotationCount = 0;
        if (session.Annotations.Count > 0)
        {
            var documentDetails = await documentManager.GetByIdAsync(document.DocumentId, cancellationToken);
            var currentVersionId = documentDetails?.Versions.FirstOrDefault(version => version.IsCurrentVersion)?.DocumentVersionId ?? Guid.Empty;

            if (currentVersionId != Guid.Empty)
            {
                foreach (var annotation in session.Annotations)
                {
                    await documentAnnotationManager.AddAsync(
                        document.DocumentId,
                        new AddDocumentAnnotationRequest
                        {
                            DocumentVersionId = currentVersionId,
                            AnnotationType = annotation.AnnotationType,
                            PageNumber = annotation.PageNumber,
                            AnnotationPayloadJson = annotation.AnnotationPayloadJson
                        },
                        cancellationToken);

                    savedAnnotationCount += 1;
                }
            }
        }

        var response = new SaveToolSessionResponse
        {
            Document = document,
            SavedAnnotationCount = savedAnnotationCount
        };

        AppLogger.Info(
            message: "Tool session save manager request completed successfully",
            action: "Create",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, DocumentId={document.DocumentId}, SavedAnnotationCount={savedAnnotationCount}");

        return response;
    }

    private async Task<ToolSessionResponse> RunPageOperationAsync(
        Guid toolSessionId,
        string operationName,
        string operationSummary,
        Func<string, string, CancellationToken, Task> operation,
        Func<IReadOnlyCollection<TemporaryPdfAnnotation>, IReadOnlyCollection<TemporaryPdfAnnotation>> annotationTransform,
        CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Tool session page operation manager request received",
            action: "Update",
            result: "Started",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, OperationName={operationName}");

        var session = await temporaryPdfSessionService.GetRequiredAsync(toolSessionId, cancellationToken);
        var operationSourcePath = await GetMaterializedSessionContentPathAsync(session, cancellationToken);
        var outputPath = await fileStorageService.CreateWritableFilePathAsync("temp", session.OriginalFileName, cancellationToken);

        await operation(operationSourcePath, outputPath, cancellationToken);

        session = await temporaryPdfSessionService.UpdateCurrentFileAsync(
            toolSessionId,
            outputPath,
            operationName,
            operationSummary,
            annotationTransform(session.Annotations),
            cancellationToken);

        var response = await MapSessionAsync(session, cancellationToken);

        AppLogger.Info(
            message: "Tool session page operation manager request completed successfully",
            action: "Update",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"ToolSessionId={toolSessionId}, OperationName={operationName}, PageCount={response.PageCount}");

        return response;
    }

    private async Task<ToolSessionResponse> MapSessionAsync(TemporaryPdfSession session, CancellationToken cancellationToken)
    {
        var protectionInfo = await pdfDocumentProcessingService.GetProtectionInfoAsync(session.CurrentStoragePath, cancellationToken);
        var pageCount = protectionInfo.RequiresPassword
            ? 0
            : await pdfDocumentProcessingService.GetPageCountAsync(session.CurrentStoragePath, cancellationToken);
        var fileInfo = new FileInfo(session.CurrentStoragePath);

        return new ToolSessionResponse
        {
            ToolSessionId = session.ToolSessionId,
            Title = session.Title,
            OriginalFileName = session.OriginalFileName,
            FileSizeInBytes = fileInfo.Length,
            PageCount = pageCount,
            FileUrl = $"/api/v1/tool-sessions/{session.ToolSessionId}/file",
            DownloadUrl = $"/api/v1/tool-sessions/{session.ToolSessionId}/file?download=true",
            IsProtected = protectionInfo.IsProtected,
            RequiresPassword = protectionInfo.RequiresPassword,
            ProtectionSummary = protectionInfo.Summary,
            HasUnsavedChanges = !string.Equals(session.CurrentStoragePath, session.OriginalStoragePath, StringComparison.OrdinalIgnoreCase)
                || HasPendingTextObjectChanges(session),
            LastOperationName = session.LastOperationName,
            LastOperationSummary = session.LastOperationSummary,
            Annotations = session.Annotations
                .OrderBy(annotation => annotation.PageNumber)
                .ThenBy(annotation => annotation.UpdatedOnUtc)
                .Select(annotation => new ToolSessionAnnotationDto
                {
                    ToolSessionAnnotationId = annotation.ToolSessionAnnotationId,
                    AnnotationType = annotation.AnnotationType,
                    PageNumber = annotation.PageNumber,
                    AnnotationPayloadJson = annotation.AnnotationPayloadJson,
                    UpdatedOnUtc = annotation.UpdatedOnUtc
                })
                .ToArray(),
            Attachments = session.Attachments
                .OrderByDescending(attachment => attachment.CreatedOnUtc)
                .Select(attachment => new ToolSessionAttachmentDto
                {
                    ToolSessionAttachmentId = attachment.ToolSessionAttachmentId,
                    AttachmentType = attachment.AttachmentType,
                    FileName = attachment.FileName,
                    MimeType = attachment.MimeType,
                    DownloadUrl = $"/api/v1/tool-sessions/{session.ToolSessionId}/attachments/{attachment.ToolSessionAttachmentId}",
                    FileSizeInBytes = attachment.FileSizeInBytes
                })
                .ToArray(),
            SplitArtifacts = session.SplitArtifacts
                .Select(splitArtifact => new ToolSessionSplitArtifactDto
                {
                    ToolSessionSplitArtifactId = splitArtifact.ToolSessionSplitArtifactId,
                    PageRange = splitArtifact.PageRange,
                    FileName = splitArtifact.FileName,
                    DownloadUrl = $"/api/v1/tool-sessions/{session.ToolSessionId}/split-files/{splitArtifact.ToolSessionSplitArtifactId}",
                    FileSizeInBytes = splitArtifact.FileSizeInBytes
                })
                .ToArray(),
            UpdatedOnUtc = session.UpdatedOnUtc
        };
    }

    private static ToolSessionDetectedTextBlockDto MapDetectedTextBlock(DetectedPdfTextBlock textBlock, Guid? textObjectId = null)
        => new()
        {
            TextObjectId = textObjectId?.ToString() ?? string.Empty,
            TextBlockId = textBlock.TextBlockId,
            SourceTextBlockId = textBlock.TextBlockId,
            PageNumber = textBlock.PageNumber,
            SourcePageNumber = textBlock.PageNumber,
            Text = textBlock.Text,
            X = textBlock.X,
            SourceX = textBlock.X,
            Y = textBlock.Y,
            SourceY = textBlock.Y,
            Width = textBlock.Width,
            SourceWidth = textBlock.Width,
            Height = textBlock.Height,
            SourceHeight = textBlock.Height,
            FontSize = textBlock.FontSize,
            SourceFontSize = textBlock.FontSize,
            FontName = textBlock.FontName,
            SourceFontName = textBlock.FontName,
            FontResourceName = textBlock.FontResourceName,
            SourceFontResourceName = textBlock.FontResourceName,
            FontPostScriptName = textBlock.FontPostScriptName,
            SourceFontPostScriptName = textBlock.FontPostScriptName,
            FontFamily = textBlock.FontFamily,
            SourceFontFamily = textBlock.FontFamily,
            FontSource = textBlock.FontSource,
            SourceFontSource = textBlock.FontSource,
            ColorHex = textBlock.ColorHex,
            SourceColorHex = textBlock.ColorHex,
            IsBold = textBlock.IsBold,
            SourceIsBold = textBlock.IsBold,
            IsItalic = textBlock.IsItalic,
            SourceIsItalic = textBlock.IsItalic,
            FontResolutionStatus = textBlock.FontResolutionStatus,
            SourceFontResolutionStatus = textBlock.FontResolutionStatus,
            EditCapability = textBlock.EditCapability,
            SourceEditCapability = textBlock.EditCapability,
            SaveCapability = textBlock.SaveCapability,
            SourceSaveCapability = textBlock.SaveCapability,
            ToUnicodeAvailable = textBlock.ToUnicodeAvailable,
            SourceToUnicodeAvailable = textBlock.ToUnicodeAvailable,
            CanEmbedForEditing = textBlock.CanEmbedForEditing,
            SourceCanEmbedForEditing = textBlock.CanEmbedForEditing,
            PreviewMode = textBlock.PreviewMode,
            PreviewCoordinateSpace = NormalizePreviewCoordinateSpace(textBlock.PreviewCoordinateSpace),
            SourcePreviewCoordinateSpace = NormalizePreviewCoordinateSpace(textBlock.PreviewCoordinateSpace),
            RenderedFontSize = textBlock.RenderedFontSize,
            SourceRenderedFontSize = textBlock.RenderedFontSize,
            LineHeightRatio = textBlock.LineHeightRatio,
            SourceLineHeightRatio = textBlock.LineHeightRatio,
            PreviewViewportWidth = textBlock.PreviewViewportWidth,
            SourcePreviewViewportWidth = textBlock.PreviewViewportWidth,
            PreviewViewportHeight = textBlock.PreviewViewportHeight,
            SourcePreviewViewportHeight = textBlock.PreviewViewportHeight,
            LayoutContainerId = textBlock.LayoutContainerId,
            SourceLayoutContainerId = textBlock.LayoutContainerId,
            EditableRunId = textBlock.EditableRunId,
            SourceEditableRunId = textBlock.EditableRunId,
            DocumentEditMode = textBlock.DocumentEditMode,
            SourceDocumentEditMode = textBlock.DocumentEditMode,
            PageEditMode = textBlock.PageEditMode,
            SourcePageEditMode = textBlock.PageEditMode,
            MissingGlyphs = textBlock.MissingGlyphs.ToArray(),
            SourceMissingGlyphs = textBlock.MissingGlyphs.ToArray(),
            LayoutLines = textBlock.LayoutLines,
            SourceLayoutLines = textBlock.LayoutLines,
            PreviewLines = textBlock.PreviewLines.Select(MapPreviewLine).ToArray(),
            SourcePreviewLines = textBlock.PreviewLines.Select(MapPreviewLine).ToArray(),
            PreviewBackgrounds = textBlock.PreviewBackgrounds.Select(MapPreviewBackground).ToArray(),
            SourcePreviewBackgrounds = textBlock.PreviewBackgrounds.Select(MapPreviewBackground).ToArray(),
            IsOverlayObject = false,
            HideSourceOnCommit = false
        };

    private static ToolSessionDetectedTextBlockDto? MapNullableDetectedTextBlock(DetectedPdfTextBlock? textBlock, Guid? textObjectId = null)
        => textBlock is null ? null : MapDetectedTextBlock(textBlock, textObjectId);

    private static ToolSessionDetectedTextBlockDto MapTextObject(TemporaryPdfTextObject textObject)
        => new()
        {
            TextObjectId = textObject.ToolSessionTextObjectId.ToString(),
            TextBlockId = textObject.CurrentTextBlockId,
            SourceTextBlockId = textObject.SourceTextBlockId,
            PageNumber = textObject.PageNumber,
            SourcePageNumber = textObject.SourcePageNumber,
            Text = textObject.Text,
            X = textObject.X,
            SourceX = textObject.SourceX,
            Y = textObject.Y,
            SourceY = textObject.SourceY,
            Width = textObject.Width,
            SourceWidth = textObject.SourceWidth,
            Height = textObject.Height,
            SourceHeight = textObject.SourceHeight,
            FontSize = textObject.FontSize,
            SourceFontSize = textObject.SourceFontSize,
            FontName = textObject.FontName,
            SourceFontName = textObject.SourceFontName,
            FontResourceName = textObject.FontResourceName,
            SourceFontResourceName = textObject.SourceFontResourceName,
            FontPostScriptName = textObject.FontPostScriptName,
            SourceFontPostScriptName = textObject.SourceFontPostScriptName,
            FontFamily = textObject.FontFamily,
            SourceFontFamily = textObject.SourceFontFamily,
            FontSource = textObject.FontSource,
            SourceFontSource = textObject.SourceFontSource,
            ColorHex = textObject.ColorHex,
            SourceColorHex = textObject.SourceColorHex,
            IsBold = textObject.IsBold,
            SourceIsBold = textObject.SourceIsBold,
            IsItalic = textObject.IsItalic,
            SourceIsItalic = textObject.SourceIsItalic,
            FontResolutionStatus = textObject.FontResolutionStatus,
            SourceFontResolutionStatus = textObject.SourceFontResolutionStatus,
            EditCapability = textObject.EditCapability,
            SourceEditCapability = textObject.SourceEditCapability,
            SaveCapability = textObject.SaveCapability,
            SourceSaveCapability = textObject.SourceSaveCapability,
            ToUnicodeAvailable = textObject.ToUnicodeAvailable,
            SourceToUnicodeAvailable = textObject.SourceToUnicodeAvailable,
            CanEmbedForEditing = textObject.CanEmbedForEditing,
            SourceCanEmbedForEditing = textObject.SourceCanEmbedForEditing,
            PreviewMode = textObject.PreviewMode,
            PreviewCoordinateSpace = textObject.PreviewCoordinateSpace,
            SourcePreviewCoordinateSpace = textObject.SourcePreviewCoordinateSpace,
            RenderedFontSize = textObject.RenderedFontSize,
            SourceRenderedFontSize = textObject.SourceRenderedFontSize,
            LineHeightRatio = textObject.LineHeightRatio,
            SourceLineHeightRatio = textObject.SourceLineHeightRatio,
            PreviewViewportWidth = textObject.PreviewViewportWidth,
            SourcePreviewViewportWidth = textObject.SourcePreviewViewportWidth,
            PreviewViewportHeight = textObject.PreviewViewportHeight,
            SourcePreviewViewportHeight = textObject.SourcePreviewViewportHeight,
            LayoutContainerId = textObject.LayoutContainerId,
            SourceLayoutContainerId = textObject.SourceLayoutContainerId,
            EditableRunId = textObject.EditableRunId,
            SourceEditableRunId = textObject.SourceEditableRunId,
            DocumentEditMode = textObject.DocumentEditMode,
            SourceDocumentEditMode = textObject.SourceDocumentEditMode,
            PageEditMode = textObject.PageEditMode,
            SourcePageEditMode = textObject.SourcePageEditMode,
            MissingGlyphs = textObject.MissingGlyphs.ToArray(),
            SourceMissingGlyphs = textObject.SourceMissingGlyphs.ToArray(),
            LayoutLines = textObject.LayoutLines,
            SourceLayoutLines = textObject.SourceLayoutLines,
            PreviewLines = textObject.PreviewLines.Select(MapPreviewLine).ToArray(),
            SourcePreviewLines = textObject.SourcePreviewLines.Select(MapPreviewLine).ToArray(),
            PreviewBackgrounds = textObject.PreviewBackgrounds.Select(MapPreviewBackground).ToArray(),
            SourcePreviewBackgrounds = textObject.SourcePreviewBackgrounds.Select(MapPreviewBackground).ToArray(),
            IsOverlayObject = textObject.IsOverlayObject,
            HideSourceOnCommit = textObject.HideSourceOnCommit
        };

    private static GetToolSessionFontResourceResponse MapFontResource(PdfResolvedFontResource fontResource)
        => new()
        {
            RequestedFontName = fontResource.RequestedFontName,
            ResolvedFontName = fontResource.ResolvedFontName,
            FontFamily = fontResource.FontFamily,
            FontSource = fontResource.FontSource,
            FontFormat = fontResource.FontFormat,
            ContentType = fontResource.ContentType,
            FontDataBase64 = fontResource.FontDataBase64,
            SourceFontResourceName = fontResource.SourceFontResourceName,
            SourceFontPostScriptName = fontResource.SourceFontPostScriptName,
            SourceFontFamily = fontResource.SourceFontFamily,
            FontResolutionStatus = fontResource.FontResolutionStatus,
            ToUnicodeAvailable = fontResource.ToUnicodeAvailable,
            CanEmbedForEditing = fontResource.CanEmbedForEditing,
            EditCapability = fontResource.EditCapability,
            SaveCapability = fontResource.SaveCapability,
            MissingGlyphs = fontResource.MissingGlyphs.ToArray(),
            IsFallback = fontResource.IsFallback,
            Warning = fontResource.Warning
        };

    private async Task<TemporaryPdfSession> EnsureSessionTextObjectsAsync(TemporaryPdfSession session, CancellationToken cancellationToken)
    {
        if (session.TextObjects.Count > 0 &&
            string.Equals(session.TextObjectsBaseStoragePath, session.CurrentStoragePath, StringComparison.OrdinalIgnoreCase))
        {
            return session;
        }

        var textBlocks = await pdfTextEditingService.ExtractTextBlocksAsync(session.CurrentStoragePath, cancellationToken);
        await SynchronizeSessionTextObjectsAsync(session, textBlocks, cancellationToken);
        return await temporaryPdfSessionService.GetRequiredAsync(session.ToolSessionId, cancellationToken);
    }

    private async Task<IReadOnlyCollection<TemporaryPdfTextObject>> SynchronizeSessionTextObjectsAsync(
        TemporaryPdfSession session,
        IReadOnlyCollection<DetectedPdfTextBlock> textBlocks,
        CancellationToken cancellationToken)
    {
        var synchronizedTextObjects = textBlocks
            .Select(textBlock => CreateTextObject(textBlock, Guid.NewGuid()))
            .ToArray();

        session = await temporaryPdfSessionService.UpdateTextObjectsAsync(
            session.ToolSessionId,
            synchronizedTextObjects,
            lastOperationName: null,
            lastOperationSummary: null,
            cancellationToken);
        session.TextObjectsBaseStoragePath = session.CurrentStoragePath;

        return synchronizedTextObjects;
    }

    private static bool HasPendingTextObjectChanges(TemporaryPdfSession session)
        => session.TextObjects.Any(textObject => textObject.IsOverlayObject);

    private async Task<string> GetMaterializedSessionContentPathAsync(TemporaryPdfSession session, CancellationToken cancellationToken)
    {
        session = await EnsureSessionTextObjectsAsync(session, cancellationToken);
        var overlayTextObjects = session.TextObjects
            .Where(textObject => textObject.IsOverlayObject)
            .OrderBy(textObject => textObject.PageNumber)
            .ThenBy(textObject => textObject.Y)
            .ThenBy(textObject => textObject.X)
            .ToArray();

        if (overlayTextObjects.Length == 0)
        {
            return session.CurrentStoragePath;
        }

        if (overlayTextObjects.Any(RequiresExactSaveWarning))
        {
            throw new InvalidOperationException(
                "This PDF text cannot be saved exactly because the selected font cannot safely preserve the original document styling. Choose a compatible installed font before saving or downloading.");
        }

        var outputPath = await fileStorageService.CreateWritableFilePathAsync("temp", session.OriginalFileName, cancellationToken);
        await pdfTextEditingService.ApplyTextOverlaysAsync(
            session.CurrentStoragePath,
            outputPath,
            overlayTextObjects
                .Select(MapOverlayOperation)
                .ToArray(),
            cancellationToken);

        return outputPath;
    }

    private static TemporaryPdfTextObject? FindBestTextObjectMatch(
        IReadOnlyCollection<TemporaryPdfTextObject> candidateTextObjects,
        DetectedPdfTextBlock textBlock)
    {
        var normalizedText = NormalizeText(textBlock.Text);
        var targetCenterX = textBlock.X + (textBlock.Width / 2d);
        var targetCenterY = textBlock.Y + (textBlock.Height / 2d);

        return candidateTextObjects
            .Where(textObject => textObject.PageNumber == textBlock.PageNumber)
            .Select(textObject =>
            {
                var candidateCenterX = textObject.X + (textObject.Width / 2d);
                var candidateCenterY = textObject.Y + (textObject.Height / 2d);
                var centerDistance = Math.Sqrt(
                    Math.Pow(candidateCenterX - targetCenterX, 2d) +
                    Math.Pow(candidateCenterY - targetCenterY, 2d));
                var widthDelta = Math.Abs(textObject.Width - textBlock.Width);
                var heightDelta = Math.Abs(textObject.Height - textBlock.Height);
                var fontSizeDelta = Math.Abs(textObject.FontSize - textBlock.FontSize);
                var textScore = CalculateTextSimilarityScore(textObject.Text, textBlock.Text);
                var fontNameMatches = string.Equals(textObject.FontName, textBlock.FontName, StringComparison.OrdinalIgnoreCase);
                var score = textScore
                    - (centerDistance * 8d)
                    - (widthDelta * 1.5d)
                    - (heightDelta * 1.5d)
                    - (fontSizeDelta * 0.03d)
                    + (fontNameMatches ? 0.2d : 0d);

                return new
                {
                    TextObject = textObject,
                    Score = score,
                    CenterDistance = centerDistance
                };
            })
            .Where(candidate => candidate.Score > 0.35d || candidate.CenterDistance <= 0.025d)
            .OrderByDescending(candidate => candidate.Score)
            .ThenBy(candidate => candidate.CenterDistance)
            .Select(candidate => candidate.TextObject)
            .FirstOrDefault();
    }

    private static double CalculateTextSimilarityScore(string sourceText, string targetText)
    {
        var normalizedSource = NormalizeText(sourceText);
        var normalizedTarget = NormalizeText(targetText);

        if (string.IsNullOrWhiteSpace(normalizedSource) || string.IsNullOrWhiteSpace(normalizedTarget))
        {
            return 0d;
        }

        if (string.Equals(normalizedSource, normalizedTarget, StringComparison.OrdinalIgnoreCase))
        {
            return 2d;
        }

        if (normalizedSource.Contains(normalizedTarget, StringComparison.OrdinalIgnoreCase) ||
            normalizedTarget.Contains(normalizedSource, StringComparison.OrdinalIgnoreCase))
        {
            return 1.2d;
        }

        var commonPrefixLength = 0;
        var maxPrefixLength = Math.Min(normalizedSource.Length, normalizedTarget.Length);
        while (commonPrefixLength < maxPrefixLength &&
               char.ToUpperInvariant(normalizedSource[commonPrefixLength]) == char.ToUpperInvariant(normalizedTarget[commonPrefixLength]))
        {
            commonPrefixLength += 1;
        }

        return (double)commonPrefixLength / Math.Max(Math.Max(normalizedSource.Length, normalizedTarget.Length), 1);
    }

    private static string NormalizeText(string? value)
        => string.Join(" ", (value ?? string.Empty)
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
            .Trim();

    private static TemporaryPdfTextObject ResolveTextObject(TemporaryPdfSession session, string? textObjectId, string? textBlockId)
    {
        if (Guid.TryParse(textObjectId, out var parsedTextObjectId))
        {
            var resolvedByObjectId = session.TextObjects.FirstOrDefault(textObject => textObject.ToolSessionTextObjectId == parsedTextObjectId);
            if (resolvedByObjectId is not null)
            {
                return resolvedByObjectId;
            }
        }

        if (!string.IsNullOrWhiteSpace(textBlockId))
        {
            var resolvedByBlockId = session.TextObjects.FirstOrDefault(
                textObject => string.Equals(textObject.CurrentTextBlockId, textBlockId.Trim(), StringComparison.Ordinal));
            if (resolvedByBlockId is not null)
            {
                return resolvedByBlockId;
            }
        }

        throw new InvalidOperationException("The selected PDF text object could not be found anymore. Reload the editor snapshot and try again.");
    }

    private static TemporaryPdfTextObject CreateTextObject(DetectedPdfTextBlock textBlock, Guid toolSessionTextObjectId)
        => new()
        {
            ToolSessionTextObjectId = toolSessionTextObjectId,
            CurrentTextBlockId = textBlock.TextBlockId,
            SourceTextBlockId = textBlock.TextBlockId,
            PageNumber = textBlock.PageNumber,
            SourcePageNumber = textBlock.PageNumber,
            Text = textBlock.Text,
            SourceText = textBlock.Text,
            X = textBlock.X,
            SourceX = textBlock.X,
            Y = textBlock.Y,
            SourceY = textBlock.Y,
            Width = textBlock.Width,
            SourceWidth = textBlock.Width,
            Height = textBlock.Height,
            SourceHeight = textBlock.Height,
            FontSize = textBlock.FontSize,
            SourceFontSize = textBlock.FontSize,
            FontName = textBlock.FontName,
            SourceFontName = textBlock.FontName,
            FontResourceName = textBlock.FontResourceName,
            SourceFontResourceName = textBlock.FontResourceName,
            FontPostScriptName = textBlock.FontPostScriptName,
            SourceFontPostScriptName = textBlock.FontPostScriptName,
            FontFamily = textBlock.FontFamily,
            SourceFontFamily = textBlock.FontFamily,
            FontSource = textBlock.FontSource,
            SourceFontSource = textBlock.FontSource,
            ColorHex = textBlock.ColorHex,
            SourceColorHex = textBlock.ColorHex,
            IsBold = textBlock.IsBold,
            SourceIsBold = textBlock.IsBold,
            IsItalic = textBlock.IsItalic,
            SourceIsItalic = textBlock.IsItalic,
            FontResolutionStatus = textBlock.FontResolutionStatus,
            SourceFontResolutionStatus = textBlock.FontResolutionStatus,
            EditCapability = textBlock.EditCapability,
            SourceEditCapability = textBlock.EditCapability,
            SaveCapability = textBlock.SaveCapability,
            SourceSaveCapability = textBlock.SaveCapability,
            ToUnicodeAvailable = textBlock.ToUnicodeAvailable,
            SourceToUnicodeAvailable = textBlock.ToUnicodeAvailable,
            CanEmbedForEditing = textBlock.CanEmbedForEditing,
            SourceCanEmbedForEditing = textBlock.CanEmbedForEditing,
            PreviewMode = NormalizePreviewMode(textBlock.PreviewMode),
            PreviewCoordinateSpace = NormalizePreviewCoordinateSpace(textBlock.PreviewCoordinateSpace),
            SourcePreviewCoordinateSpace = NormalizePreviewCoordinateSpace(textBlock.PreviewCoordinateSpace),
            RenderedFontSize = textBlock.RenderedFontSize,
            SourceRenderedFontSize = textBlock.RenderedFontSize,
            LineHeightRatio = textBlock.LineHeightRatio,
            SourceLineHeightRatio = textBlock.LineHeightRatio,
            PreviewViewportWidth = textBlock.PreviewViewportWidth,
            SourcePreviewViewportWidth = textBlock.PreviewViewportWidth,
            PreviewViewportHeight = textBlock.PreviewViewportHeight,
            SourcePreviewViewportHeight = textBlock.PreviewViewportHeight,
            LayoutContainerId = textBlock.LayoutContainerId,
            SourceLayoutContainerId = textBlock.LayoutContainerId,
            EditableRunId = textBlock.EditableRunId,
            SourceEditableRunId = textBlock.EditableRunId,
            DocumentEditMode = textBlock.DocumentEditMode,
            SourceDocumentEditMode = textBlock.DocumentEditMode,
            PageEditMode = textBlock.PageEditMode,
            SourcePageEditMode = textBlock.PageEditMode,
            MissingGlyphs = textBlock.MissingGlyphs.ToArray(),
            SourceMissingGlyphs = textBlock.MissingGlyphs.ToArray(),
            LayoutLines = textBlock.LayoutLines,
            SourceLayoutLines = textBlock.LayoutLines,
            PreviewLines = textBlock.PreviewLines,
            SourcePreviewLines = textBlock.PreviewLines,
            PreviewBackgrounds = textBlock.PreviewBackgrounds,
            SourcePreviewBackgrounds = textBlock.PreviewBackgrounds,
            IsOverlayObject = false,
            HideSourceOnCommit = false,
            UpdatedOnUtc = DateTime.UtcNow
        };

    private async Task<TemporaryPdfSession> ReplaceSessionTextObjectAsync(
        TemporaryPdfSession session,
        TemporaryPdfTextObject updatedTextObject,
        string operationName,
        string operationSummary,
        CancellationToken cancellationToken)
    {
        CaptureTextUndoSnapshot(session, operationName);

        var nextTextObjects = session.TextObjects
            .Where(textObject => textObject.ToolSessionTextObjectId != updatedTextObject.ToolSessionTextObjectId)
            .Concat([updatedTextObject])
            .ToArray();

        return await temporaryPdfSessionService.UpdateTextObjectsAsync(
            session.ToolSessionId,
            nextTextObjects,
            operationName,
            operationSummary,
            cancellationToken);
    }

    private async Task<TemporaryPdfSession> AppendSessionTextObjectAsync(
        TemporaryPdfSession session,
        TemporaryPdfTextObject appendedTextObject,
        string operationName,
        string operationSummary,
        CancellationToken cancellationToken)
    {
        CaptureTextUndoSnapshot(session, operationName);

        var nextTextObjects = session.TextObjects.Concat([appendedTextObject]).ToArray();

        return await temporaryPdfSessionService.UpdateTextObjectsAsync(
            session.ToolSessionId,
            nextTextObjects,
            operationName,
            operationSummary,
            cancellationToken);
    }

    private static void CaptureTextUndoSnapshot(TemporaryPdfSession session, string operationName)
    {
        if (session.TextObjects.Count == 0)
        {
            return;
        }

        var nextHistory = session.TextObjectUndoStack
            .Append(new TemporaryPdfTextObjectHistoryEntry
            {
                OperationName = operationName,
                TextObjects = CloneTextObjects(session.TextObjects),
                CreatedOnUtc = DateTime.UtcNow
            })
            .OrderByDescending(entry => entry.CreatedOnUtc)
            .Take(40)
            .OrderBy(entry => entry.CreatedOnUtc)
            .ToArray();

        session.TextObjectUndoStack = nextHistory;
    }

    private static TemporaryPdfTextObject[] CloneTextObjects(IReadOnlyCollection<TemporaryPdfTextObject> textObjects)
        => JsonSerializer.Deserialize<TemporaryPdfTextObject[]>(
            JsonSerializer.Serialize(textObjects, JsonSerializerOptions.Web),
            JsonSerializerOptions.Web) ?? Array.Empty<TemporaryPdfTextObject>();

    private static string NormalizeReplacementTextForEditing(string? text)
        => string.IsNullOrEmpty(text)
            ? string.Empty
            : text.Replace("\r\n", "\n").Replace('\r', '\n').Trim('\uFEFF');

    private static TemporaryPdfTextObject CreateUpdatedOverlayTextObject(TemporaryPdfTextObject sourceTextObject, string replacementText)
    {
        var updatedOnUtc = DateTime.UtcNow;
        return new TemporaryPdfTextObject
        {
            ToolSessionTextObjectId = sourceTextObject.ToolSessionTextObjectId,
            CurrentTextBlockId = BuildOverlayTextBlockId(sourceTextObject.ToolSessionTextObjectId),
            SourceTextBlockId = sourceTextObject.SourceTextBlockId,
            PageNumber = sourceTextObject.PageNumber,
            SourcePageNumber = sourceTextObject.SourcePageNumber,
            Text = replacementText,
            SourceText = sourceTextObject.SourceText,
            X = sourceTextObject.X,
            SourceX = sourceTextObject.SourceX,
            Y = sourceTextObject.Y,
            SourceY = sourceTextObject.SourceY,
            Width = sourceTextObject.Width,
            SourceWidth = sourceTextObject.SourceWidth,
            Height = sourceTextObject.Height,
            SourceHeight = sourceTextObject.SourceHeight,
            FontSize = sourceTextObject.FontSize,
            SourceFontSize = sourceTextObject.SourceFontSize,
            FontName = sourceTextObject.FontName,
            SourceFontName = sourceTextObject.SourceFontName,
            FontResourceName = sourceTextObject.FontResourceName,
            SourceFontResourceName = sourceTextObject.SourceFontResourceName,
            FontPostScriptName = sourceTextObject.FontPostScriptName,
            SourceFontPostScriptName = sourceTextObject.SourceFontPostScriptName,
            FontFamily = sourceTextObject.FontFamily,
            SourceFontFamily = sourceTextObject.SourceFontFamily,
            FontSource = sourceTextObject.FontSource,
            SourceFontSource = sourceTextObject.SourceFontSource,
            ColorHex = sourceTextObject.ColorHex,
            SourceColorHex = sourceTextObject.SourceColorHex,
            IsBold = sourceTextObject.IsBold,
            SourceIsBold = sourceTextObject.SourceIsBold,
            IsItalic = sourceTextObject.IsItalic,
            SourceIsItalic = sourceTextObject.SourceIsItalic,
            FontResolutionStatus = sourceTextObject.FontResolutionStatus,
            SourceFontResolutionStatus = sourceTextObject.SourceFontResolutionStatus,
            EditCapability = sourceTextObject.EditCapability,
            SourceEditCapability = sourceTextObject.SourceEditCapability,
            SaveCapability = sourceTextObject.SaveCapability,
            SourceSaveCapability = sourceTextObject.SourceSaveCapability,
            ToUnicodeAvailable = sourceTextObject.ToUnicodeAvailable,
            SourceToUnicodeAvailable = sourceTextObject.SourceToUnicodeAvailable,
            CanEmbedForEditing = sourceTextObject.CanEmbedForEditing,
            SourceCanEmbedForEditing = sourceTextObject.SourceCanEmbedForEditing,
            PreviewMode = "preview",
            PreviewCoordinateSpace = sourceTextObject.PreviewCoordinateSpace,
            SourcePreviewCoordinateSpace = sourceTextObject.SourcePreviewCoordinateSpace,
            RenderedFontSize = sourceTextObject.RenderedFontSize,
            SourceRenderedFontSize = sourceTextObject.SourceRenderedFontSize,
            LineHeightRatio = sourceTextObject.LineHeightRatio,
            SourceLineHeightRatio = sourceTextObject.SourceLineHeightRatio,
            PreviewViewportWidth = sourceTextObject.PreviewViewportWidth,
            SourcePreviewViewportWidth = sourceTextObject.SourcePreviewViewportWidth,
            PreviewViewportHeight = sourceTextObject.PreviewViewportHeight,
            SourcePreviewViewportHeight = sourceTextObject.SourcePreviewViewportHeight,
            LayoutContainerId = sourceTextObject.LayoutContainerId,
            SourceLayoutContainerId = sourceTextObject.SourceLayoutContainerId,
            EditableRunId = sourceTextObject.EditableRunId,
            SourceEditableRunId = sourceTextObject.SourceEditableRunId,
            DocumentEditMode = sourceTextObject.DocumentEditMode,
            SourceDocumentEditMode = sourceTextObject.SourceDocumentEditMode,
            PageEditMode = sourceTextObject.PageEditMode,
            SourcePageEditMode = sourceTextObject.SourcePageEditMode,
            MissingGlyphs = sourceTextObject.MissingGlyphs.ToArray(),
            SourceMissingGlyphs = sourceTextObject.SourceMissingGlyphs.ToArray(),
            LayoutLines = sourceTextObject.LayoutLines,
            SourceLayoutLines = sourceTextObject.SourceLayoutLines,
            PreviewLines = sourceTextObject.PreviewLines,
            SourcePreviewLines = sourceTextObject.SourcePreviewLines,
            PreviewBackgrounds = sourceTextObject.PreviewBackgrounds,
            SourcePreviewBackgrounds = sourceTextObject.SourcePreviewBackgrounds,
            IsOverlayObject = true,
            HideSourceOnCommit = true,
            UpdatedOnUtc = updatedOnUtc
        };
    }

    private static TemporaryPdfTextObject ApplyRequestedTextStyle(
        TemporaryPdfTextObject textObject,
        string? fontName,
        double? fontSize,
        string? colorHex,
        bool? isBold,
        bool? isItalic)
    {
        var nextFontName = string.IsNullOrWhiteSpace(fontName)
            ? textObject.FontName
            : fontName.Trim();
        var nextFontSize = fontSize.HasValue && fontSize.Value > 0
            ? fontSize.Value
            : textObject.FontSize;
        var nextColorHex = NormalizeColorHex(colorHex, textObject.ColorHex);
        var nextIsBold = isBold ?? textObject.IsBold;
        var nextIsItalic = isItalic ?? textObject.IsItalic;

        return new TemporaryPdfTextObject
        {
            ToolSessionTextObjectId = textObject.ToolSessionTextObjectId,
            CurrentTextBlockId = textObject.CurrentTextBlockId,
            SourceTextBlockId = textObject.SourceTextBlockId,
            PageNumber = textObject.PageNumber,
            SourcePageNumber = textObject.SourcePageNumber,
            Text = textObject.Text,
            SourceText = textObject.SourceText,
            X = textObject.X,
            SourceX = textObject.SourceX,
            Y = textObject.Y,
            SourceY = textObject.SourceY,
            Width = textObject.Width,
            SourceWidth = textObject.SourceWidth,
            Height = textObject.Height,
            SourceHeight = textObject.SourceHeight,
            FontSize = nextFontSize,
            SourceFontSize = textObject.SourceFontSize,
            FontName = nextFontName,
            SourceFontName = textObject.SourceFontName,
            FontResourceName = textObject.FontResourceName,
            SourceFontResourceName = textObject.SourceFontResourceName,
            FontPostScriptName = textObject.FontPostScriptName,
            SourceFontPostScriptName = textObject.SourceFontPostScriptName,
            FontFamily = textObject.FontFamily,
            SourceFontFamily = textObject.SourceFontFamily,
            FontSource = textObject.FontSource,
            SourceFontSource = textObject.SourceFontSource,
            ColorHex = nextColorHex,
            SourceColorHex = textObject.SourceColorHex,
            IsBold = nextIsBold,
            SourceIsBold = textObject.SourceIsBold,
            IsItalic = nextIsItalic,
            SourceIsItalic = textObject.SourceIsItalic,
            FontResolutionStatus = textObject.FontResolutionStatus,
            SourceFontResolutionStatus = textObject.SourceFontResolutionStatus,
            EditCapability = textObject.EditCapability,
            SourceEditCapability = textObject.SourceEditCapability,
            SaveCapability = textObject.SaveCapability,
            SourceSaveCapability = textObject.SourceSaveCapability,
            ToUnicodeAvailable = textObject.ToUnicodeAvailable,
            SourceToUnicodeAvailable = textObject.SourceToUnicodeAvailable,
            CanEmbedForEditing = textObject.CanEmbedForEditing,
            SourceCanEmbedForEditing = textObject.SourceCanEmbedForEditing,
            PreviewMode = textObject.PreviewMode,
            PreviewCoordinateSpace = textObject.PreviewCoordinateSpace,
            SourcePreviewCoordinateSpace = textObject.SourcePreviewCoordinateSpace,
            RenderedFontSize = nextFontSize,
            SourceRenderedFontSize = textObject.SourceRenderedFontSize,
            LineHeightRatio = textObject.LineHeightRatio,
            SourceLineHeightRatio = textObject.SourceLineHeightRatio,
            PreviewViewportWidth = textObject.PreviewViewportWidth,
            SourcePreviewViewportWidth = textObject.SourcePreviewViewportWidth,
            PreviewViewportHeight = textObject.PreviewViewportHeight,
            SourcePreviewViewportHeight = textObject.SourcePreviewViewportHeight,
            LayoutContainerId = textObject.LayoutContainerId,
            SourceLayoutContainerId = textObject.SourceLayoutContainerId,
            EditableRunId = textObject.EditableRunId,
            SourceEditableRunId = textObject.SourceEditableRunId,
            DocumentEditMode = textObject.DocumentEditMode,
            SourceDocumentEditMode = textObject.SourceDocumentEditMode,
            PageEditMode = textObject.PageEditMode,
            SourcePageEditMode = textObject.SourcePageEditMode,
            MissingGlyphs = textObject.MissingGlyphs.ToArray(),
            SourceMissingGlyphs = textObject.SourceMissingGlyphs.ToArray(),
            LayoutLines = textObject.LayoutLines,
            SourceLayoutLines = textObject.SourceLayoutLines,
            PreviewLines = textObject.PreviewLines,
            SourcePreviewLines = textObject.SourcePreviewLines,
            PreviewBackgrounds = textObject.PreviewBackgrounds,
            SourcePreviewBackgrounds = textObject.SourcePreviewBackgrounds,
            IsOverlayObject = textObject.IsOverlayObject,
            HideSourceOnCommit = textObject.HideSourceOnCommit,
            UpdatedOnUtc = DateTime.UtcNow
        };
    }

    private static bool ShouldPreserveCurrentTextObjectLayout(
        TemporaryPdfTextObject sourceTextObject,
        TemporaryPdfTextObject updatedTextObject)
    {
        const double fontSizeTolerance = 0.05d;
        const double sizeTolerance = 0.0025d;

        var textMatches = string.Equals(
            NormalizeText(sourceTextObject.Text),
            NormalizeText(updatedTextObject.Text),
            StringComparison.Ordinal);

        var styleMatches =
            string.Equals(sourceTextObject.FontName, updatedTextObject.FontName, StringComparison.OrdinalIgnoreCase) &&
            Math.Abs(sourceTextObject.FontSize - updatedTextObject.FontSize) < fontSizeTolerance &&
            string.Equals(sourceTextObject.ColorHex, updatedTextObject.ColorHex, StringComparison.OrdinalIgnoreCase) &&
            sourceTextObject.IsBold == updatedTextObject.IsBold &&
            sourceTextObject.IsItalic == updatedTextObject.IsItalic;

        var sizeMatches =
            Math.Abs(sourceTextObject.Width - updatedTextObject.Width) < sizeTolerance &&
            Math.Abs(sourceTextObject.Height - updatedTextObject.Height) < sizeTolerance;

        return textMatches && styleMatches && sizeMatches;
    }

    private static bool ShouldUsePreservedSourcePreviewMode(
        TemporaryPdfTextObject sourceTextObject,
        TemporaryPdfTextObject updatedTextObject)
    {
        const double fontSizeTolerance = 0.05d;
        const double sizeTolerance = 0.0025d;

        var textMatchesSource = string.Equals(
            NormalizeText(sourceTextObject.SourceText),
            NormalizeText(updatedTextObject.Text),
            StringComparison.Ordinal);

        var styleMatchesSource =
            string.Equals(sourceTextObject.SourceFontName, updatedTextObject.FontName, StringComparison.OrdinalIgnoreCase) &&
            Math.Abs(sourceTextObject.SourceFontSize - updatedTextObject.FontSize) < fontSizeTolerance &&
            string.Equals(sourceTextObject.SourceColorHex, updatedTextObject.ColorHex, StringComparison.OrdinalIgnoreCase) &&
            sourceTextObject.SourceIsBold == updatedTextObject.IsBold &&
            sourceTextObject.SourceIsItalic == updatedTextObject.IsItalic;

        var sizeMatchesSource =
            Math.Abs(sourceTextObject.SourceWidth - updatedTextObject.Width) < sizeTolerance &&
            Math.Abs(sourceTextObject.SourceHeight - updatedTextObject.Height) < sizeTolerance;

        return textMatchesSource && styleMatchesSource && sizeMatchesSource;
    }

    private static TemporaryPdfTextObject ApplyPreservedSourceLayout(
        TemporaryPdfTextObject updatedTextObject,
        TemporaryPdfTextObject sourceTextObject)
        => new()
        {
            ToolSessionTextObjectId = updatedTextObject.ToolSessionTextObjectId,
            CurrentTextBlockId = updatedTextObject.CurrentTextBlockId,
            SourceTextBlockId = updatedTextObject.SourceTextBlockId,
            PageNumber = updatedTextObject.PageNumber,
            SourcePageNumber = updatedTextObject.SourcePageNumber,
            Text = updatedTextObject.Text,
            SourceText = updatedTextObject.SourceText,
            X = updatedTextObject.X,
            SourceX = updatedTextObject.SourceX,
            Y = updatedTextObject.Y,
            SourceY = updatedTextObject.SourceY,
            Width = sourceTextObject.SourceWidth,
            SourceWidth = sourceTextObject.SourceWidth,
            Height = sourceTextObject.SourceHeight,
            SourceHeight = sourceTextObject.SourceHeight,
            FontSize = sourceTextObject.SourceFontSize,
            SourceFontSize = sourceTextObject.SourceFontSize,
            FontName = sourceTextObject.SourceFontName,
            SourceFontName = sourceTextObject.SourceFontName,
            FontResourceName = sourceTextObject.SourceFontResourceName,
            SourceFontResourceName = sourceTextObject.SourceFontResourceName,
            FontPostScriptName = sourceTextObject.SourceFontPostScriptName,
            SourceFontPostScriptName = sourceTextObject.SourceFontPostScriptName,
            FontFamily = sourceTextObject.SourceFontFamily,
            SourceFontFamily = sourceTextObject.SourceFontFamily,
            FontSource = sourceTextObject.SourceFontSource,
            SourceFontSource = sourceTextObject.SourceFontSource,
            ColorHex = sourceTextObject.SourceColorHex,
            SourceColorHex = sourceTextObject.SourceColorHex,
            IsBold = sourceTextObject.SourceIsBold,
            SourceIsBold = sourceTextObject.SourceIsBold,
            IsItalic = sourceTextObject.SourceIsItalic,
            SourceIsItalic = sourceTextObject.SourceIsItalic,
            FontResolutionStatus = sourceTextObject.SourceFontResolutionStatus,
            SourceFontResolutionStatus = sourceTextObject.SourceFontResolutionStatus,
            EditCapability = sourceTextObject.SourceEditCapability,
            SourceEditCapability = sourceTextObject.SourceEditCapability,
            SaveCapability = sourceTextObject.SourceSaveCapability,
            SourceSaveCapability = sourceTextObject.SourceSaveCapability,
            ToUnicodeAvailable = sourceTextObject.SourceToUnicodeAvailable,
            SourceToUnicodeAvailable = sourceTextObject.SourceToUnicodeAvailable,
            CanEmbedForEditing = sourceTextObject.SourceCanEmbedForEditing,
            SourceCanEmbedForEditing = sourceTextObject.SourceCanEmbedForEditing,
            PreviewMode = "preserved-source",
            PreviewCoordinateSpace = NormalizePreviewCoordinateSpace(sourceTextObject.SourcePreviewCoordinateSpace),
            SourcePreviewCoordinateSpace = NormalizePreviewCoordinateSpace(sourceTextObject.SourcePreviewCoordinateSpace),
            RenderedFontSize = sourceTextObject.SourceRenderedFontSize,
            SourceRenderedFontSize = sourceTextObject.SourceRenderedFontSize,
            LineHeightRatio = sourceTextObject.SourceLineHeightRatio,
            SourceLineHeightRatio = sourceTextObject.SourceLineHeightRatio,
            PreviewViewportWidth = sourceTextObject.SourcePreviewViewportWidth,
            SourcePreviewViewportWidth = sourceTextObject.SourcePreviewViewportWidth,
            PreviewViewportHeight = sourceTextObject.SourcePreviewViewportHeight,
            SourcePreviewViewportHeight = sourceTextObject.SourcePreviewViewportHeight,
            LayoutContainerId = sourceTextObject.SourceLayoutContainerId,
            SourceLayoutContainerId = sourceTextObject.SourceLayoutContainerId,
            EditableRunId = sourceTextObject.SourceEditableRunId,
            SourceEditableRunId = sourceTextObject.SourceEditableRunId,
            DocumentEditMode = sourceTextObject.SourceDocumentEditMode,
            SourceDocumentEditMode = sourceTextObject.SourceDocumentEditMode,
            PageEditMode = sourceTextObject.SourcePageEditMode,
            SourcePageEditMode = sourceTextObject.SourcePageEditMode,
            MissingGlyphs = sourceTextObject.SourceMissingGlyphs.ToArray(),
            SourceMissingGlyphs = sourceTextObject.SourceMissingGlyphs.ToArray(),
            LayoutLines = sourceTextObject.SourceLayoutLines,
            SourceLayoutLines = sourceTextObject.SourceLayoutLines,
            PreviewLines = sourceTextObject.SourcePreviewLines,
            SourcePreviewLines = sourceTextObject.SourcePreviewLines,
            PreviewBackgrounds = sourceTextObject.SourcePreviewBackgrounds,
            SourcePreviewBackgrounds = sourceTextObject.SourcePreviewBackgrounds,
            IsOverlayObject = updatedTextObject.IsOverlayObject,
            HideSourceOnCommit = updatedTextObject.HideSourceOnCommit,
            UpdatedOnUtc = DateTime.UtcNow
        };

    private static TemporaryPdfTextObject CreateMovedOverlayTextObject(
        TemporaryPdfTextObject sourceTextObject,
        string nextText,
        double x,
        double y,
        double width,
        double height)
    {
        var updatedOnUtc = DateTime.UtcNow;
        return new TemporaryPdfTextObject
        {
            ToolSessionTextObjectId = sourceTextObject.ToolSessionTextObjectId,
            CurrentTextBlockId = BuildOverlayTextBlockId(sourceTextObject.ToolSessionTextObjectId),
            SourceTextBlockId = sourceTextObject.SourceTextBlockId,
            PageNumber = sourceTextObject.PageNumber,
            SourcePageNumber = sourceTextObject.SourcePageNumber,
            Text = string.IsNullOrWhiteSpace(nextText) ? sourceTextObject.Text : nextText,
            SourceText = sourceTextObject.SourceText,
            X = x,
            SourceX = sourceTextObject.SourceX,
            Y = y,
            SourceY = sourceTextObject.SourceY,
            Width = width,
            SourceWidth = sourceTextObject.SourceWidth,
            Height = height,
            SourceHeight = sourceTextObject.SourceHeight,
            FontSize = sourceTextObject.FontSize,
            SourceFontSize = sourceTextObject.SourceFontSize,
            FontName = sourceTextObject.FontName,
            SourceFontName = sourceTextObject.SourceFontName,
            FontResourceName = sourceTextObject.FontResourceName,
            SourceFontResourceName = sourceTextObject.SourceFontResourceName,
            FontPostScriptName = sourceTextObject.FontPostScriptName,
            SourceFontPostScriptName = sourceTextObject.SourceFontPostScriptName,
            FontFamily = sourceTextObject.FontFamily,
            SourceFontFamily = sourceTextObject.SourceFontFamily,
            FontSource = sourceTextObject.FontSource,
            SourceFontSource = sourceTextObject.SourceFontSource,
            ColorHex = sourceTextObject.ColorHex,
            SourceColorHex = sourceTextObject.SourceColorHex,
            IsBold = sourceTextObject.IsBold,
            SourceIsBold = sourceTextObject.SourceIsBold,
            IsItalic = sourceTextObject.IsItalic,
            SourceIsItalic = sourceTextObject.SourceIsItalic,
            FontResolutionStatus = sourceTextObject.FontResolutionStatus,
            SourceFontResolutionStatus = sourceTextObject.SourceFontResolutionStatus,
            EditCapability = sourceTextObject.EditCapability,
            SourceEditCapability = sourceTextObject.SourceEditCapability,
            SaveCapability = sourceTextObject.SaveCapability,
            SourceSaveCapability = sourceTextObject.SourceSaveCapability,
            ToUnicodeAvailable = sourceTextObject.ToUnicodeAvailable,
            SourceToUnicodeAvailable = sourceTextObject.SourceToUnicodeAvailable,
            CanEmbedForEditing = sourceTextObject.CanEmbedForEditing,
            SourceCanEmbedForEditing = sourceTextObject.SourceCanEmbedForEditing,
            PreviewMode = NormalizePreviewMode(sourceTextObject.PreviewMode),
            PreviewCoordinateSpace = NormalizePreviewCoordinateSpace(sourceTextObject.PreviewCoordinateSpace),
            SourcePreviewCoordinateSpace = NormalizePreviewCoordinateSpace(sourceTextObject.SourcePreviewCoordinateSpace),
            RenderedFontSize = sourceTextObject.RenderedFontSize,
            SourceRenderedFontSize = sourceTextObject.SourceRenderedFontSize,
            LineHeightRatio = sourceTextObject.LineHeightRatio,
            SourceLineHeightRatio = sourceTextObject.SourceLineHeightRatio,
            PreviewViewportWidth = sourceTextObject.PreviewViewportWidth,
            SourcePreviewViewportWidth = sourceTextObject.SourcePreviewViewportWidth,
            PreviewViewportHeight = sourceTextObject.PreviewViewportHeight,
            SourcePreviewViewportHeight = sourceTextObject.SourcePreviewViewportHeight,
            LayoutContainerId = sourceTextObject.LayoutContainerId,
            SourceLayoutContainerId = sourceTextObject.SourceLayoutContainerId,
            EditableRunId = sourceTextObject.EditableRunId,
            SourceEditableRunId = sourceTextObject.SourceEditableRunId,
            DocumentEditMode = sourceTextObject.DocumentEditMode,
            SourceDocumentEditMode = sourceTextObject.SourceDocumentEditMode,
            PageEditMode = sourceTextObject.PageEditMode,
            SourcePageEditMode = sourceTextObject.SourcePageEditMode,
            MissingGlyphs = sourceTextObject.MissingGlyphs.ToArray(),
            SourceMissingGlyphs = sourceTextObject.SourceMissingGlyphs.ToArray(),
            LayoutLines = sourceTextObject.LayoutLines,
            SourceLayoutLines = sourceTextObject.SourceLayoutLines,
            PreviewLines = sourceTextObject.PreviewLines,
            SourcePreviewLines = sourceTextObject.SourcePreviewLines,
            PreviewBackgrounds = sourceTextObject.PreviewBackgrounds,
            SourcePreviewBackgrounds = sourceTextObject.SourcePreviewBackgrounds,
            IsOverlayObject = true,
            HideSourceOnCommit = true,
            UpdatedOnUtc = updatedOnUtc
        };
    }

    private static TemporaryPdfTextObject CreateDuplicatedOverlayTextObject(
        TemporaryPdfTextObject sourceTextObject,
        string nextText,
        double x,
        double y,
        double width,
        double height)
    {
        var toolSessionTextObjectId = Guid.NewGuid();
        var updatedOnUtc = DateTime.UtcNow;
        return new TemporaryPdfTextObject
        {
            ToolSessionTextObjectId = toolSessionTextObjectId,
            CurrentTextBlockId = BuildOverlayTextBlockId(toolSessionTextObjectId),
            SourceTextBlockId = sourceTextObject.SourceTextBlockId,
            PageNumber = sourceTextObject.PageNumber,
            SourcePageNumber = sourceTextObject.SourcePageNumber,
            Text = string.IsNullOrWhiteSpace(nextText) ? sourceTextObject.Text : nextText,
            SourceText = sourceTextObject.SourceText,
            X = x,
            SourceX = sourceTextObject.SourceX,
            Y = y,
            SourceY = sourceTextObject.SourceY,
            Width = width,
            SourceWidth = sourceTextObject.SourceWidth,
            Height = height,
            SourceHeight = sourceTextObject.SourceHeight,
            FontSize = sourceTextObject.FontSize,
            SourceFontSize = sourceTextObject.SourceFontSize,
            FontName = sourceTextObject.FontName,
            SourceFontName = sourceTextObject.SourceFontName,
            FontResourceName = sourceTextObject.FontResourceName,
            SourceFontResourceName = sourceTextObject.SourceFontResourceName,
            FontPostScriptName = sourceTextObject.FontPostScriptName,
            SourceFontPostScriptName = sourceTextObject.SourceFontPostScriptName,
            FontFamily = sourceTextObject.FontFamily,
            SourceFontFamily = sourceTextObject.SourceFontFamily,
            FontSource = sourceTextObject.FontSource,
            SourceFontSource = sourceTextObject.SourceFontSource,
            ColorHex = sourceTextObject.ColorHex,
            SourceColorHex = sourceTextObject.SourceColorHex,
            IsBold = sourceTextObject.IsBold,
            SourceIsBold = sourceTextObject.SourceIsBold,
            IsItalic = sourceTextObject.IsItalic,
            SourceIsItalic = sourceTextObject.SourceIsItalic,
            FontResolutionStatus = sourceTextObject.FontResolutionStatus,
            SourceFontResolutionStatus = sourceTextObject.SourceFontResolutionStatus,
            EditCapability = sourceTextObject.EditCapability,
            SourceEditCapability = sourceTextObject.SourceEditCapability,
            SaveCapability = sourceTextObject.SaveCapability,
            SourceSaveCapability = sourceTextObject.SourceSaveCapability,
            ToUnicodeAvailable = sourceTextObject.ToUnicodeAvailable,
            SourceToUnicodeAvailable = sourceTextObject.SourceToUnicodeAvailable,
            CanEmbedForEditing = sourceTextObject.CanEmbedForEditing,
            SourceCanEmbedForEditing = sourceTextObject.SourceCanEmbedForEditing,
            PreviewMode = NormalizePreviewMode(sourceTextObject.PreviewMode),
            PreviewCoordinateSpace = NormalizePreviewCoordinateSpace(sourceTextObject.PreviewCoordinateSpace),
            SourcePreviewCoordinateSpace = NormalizePreviewCoordinateSpace(sourceTextObject.SourcePreviewCoordinateSpace),
            RenderedFontSize = sourceTextObject.RenderedFontSize,
            SourceRenderedFontSize = sourceTextObject.SourceRenderedFontSize,
            LineHeightRatio = sourceTextObject.LineHeightRatio,
            SourceLineHeightRatio = sourceTextObject.SourceLineHeightRatio,
            PreviewViewportWidth = sourceTextObject.PreviewViewportWidth,
            SourcePreviewViewportWidth = sourceTextObject.SourcePreviewViewportWidth,
            PreviewViewportHeight = sourceTextObject.PreviewViewportHeight,
            SourcePreviewViewportHeight = sourceTextObject.SourcePreviewViewportHeight,
            LayoutContainerId = sourceTextObject.LayoutContainerId,
            SourceLayoutContainerId = sourceTextObject.SourceLayoutContainerId,
            EditableRunId = sourceTextObject.EditableRunId,
            SourceEditableRunId = sourceTextObject.SourceEditableRunId,
            DocumentEditMode = sourceTextObject.DocumentEditMode,
            SourceDocumentEditMode = sourceTextObject.SourceDocumentEditMode,
            PageEditMode = sourceTextObject.PageEditMode,
            SourcePageEditMode = sourceTextObject.SourcePageEditMode,
            MissingGlyphs = sourceTextObject.MissingGlyphs.ToArray(),
            SourceMissingGlyphs = sourceTextObject.SourceMissingGlyphs.ToArray(),
            LayoutLines = sourceTextObject.LayoutLines,
            SourceLayoutLines = sourceTextObject.SourceLayoutLines,
            PreviewLines = sourceTextObject.PreviewLines,
            SourcePreviewLines = sourceTextObject.SourcePreviewLines,
            PreviewBackgrounds = sourceTextObject.PreviewBackgrounds,
            SourcePreviewBackgrounds = sourceTextObject.SourcePreviewBackgrounds,
            IsOverlayObject = true,
            HideSourceOnCommit = false,
            UpdatedOnUtc = updatedOnUtc
        };
    }

    private static TemporaryPdfTextObject ApplyPreviewLayout(TemporaryPdfTextObject sourceTextObject, DetectedPdfTextBlock previewTextBlock)
    {
        var previewBackgrounds = previewTextBlock.PreviewBackgrounds.Count > 0
            ? previewTextBlock.PreviewBackgrounds
            : sourceTextObject.PreviewBackgrounds.Count > 0
                ? sourceTextObject.PreviewBackgrounds
                : sourceTextObject.SourcePreviewBackgrounds;

        return new TemporaryPdfTextObject
        {
            ToolSessionTextObjectId = sourceTextObject.ToolSessionTextObjectId,
            CurrentTextBlockId = sourceTextObject.CurrentTextBlockId,
            SourceTextBlockId = sourceTextObject.SourceTextBlockId,
            PageNumber = sourceTextObject.PageNumber,
            SourcePageNumber = sourceTextObject.SourcePageNumber,
            Text = sourceTextObject.Text,
            SourceText = sourceTextObject.SourceText,
            X = previewTextBlock.X,
            SourceX = sourceTextObject.SourceX,
            Y = previewTextBlock.Y,
            SourceY = sourceTextObject.SourceY,
            Width = previewTextBlock.Width,
            SourceWidth = sourceTextObject.SourceWidth,
            Height = previewTextBlock.Height,
            SourceHeight = sourceTextObject.SourceHeight,
            FontSize = previewTextBlock.FontSize,
            SourceFontSize = sourceTextObject.SourceFontSize,
            FontName = previewTextBlock.FontName,
            SourceFontName = sourceTextObject.SourceFontName,
            FontResourceName = previewTextBlock.FontResourceName,
            SourceFontResourceName = sourceTextObject.SourceFontResourceName,
            FontPostScriptName = previewTextBlock.FontPostScriptName,
            SourceFontPostScriptName = sourceTextObject.SourceFontPostScriptName,
            FontFamily = previewTextBlock.FontFamily,
            SourceFontFamily = sourceTextObject.SourceFontFamily,
            FontSource = previewTextBlock.FontSource,
            SourceFontSource = sourceTextObject.SourceFontSource,
            ColorHex = previewTextBlock.ColorHex,
            SourceColorHex = sourceTextObject.SourceColorHex,
            IsBold = previewTextBlock.IsBold,
            SourceIsBold = sourceTextObject.SourceIsBold,
            IsItalic = previewTextBlock.IsItalic,
            SourceIsItalic = sourceTextObject.SourceIsItalic,
            FontResolutionStatus = previewTextBlock.FontResolutionStatus,
            SourceFontResolutionStatus = sourceTextObject.SourceFontResolutionStatus,
            EditCapability = previewTextBlock.EditCapability,
            SourceEditCapability = sourceTextObject.SourceEditCapability,
            SaveCapability = previewTextBlock.SaveCapability,
            SourceSaveCapability = sourceTextObject.SourceSaveCapability,
            ToUnicodeAvailable = previewTextBlock.ToUnicodeAvailable,
            SourceToUnicodeAvailable = sourceTextObject.SourceToUnicodeAvailable,
            CanEmbedForEditing = previewTextBlock.CanEmbedForEditing,
            SourceCanEmbedForEditing = sourceTextObject.SourceCanEmbedForEditing,
            PreviewMode = string.Equals(previewTextBlock.PreviewMode, "preview", StringComparison.OrdinalIgnoreCase) ? "preview" : NormalizePreviewMode(sourceTextObject.PreviewMode),
            PreviewCoordinateSpace = NormalizePreviewCoordinateSpace(previewTextBlock.PreviewCoordinateSpace),
            SourcePreviewCoordinateSpace = sourceTextObject.SourcePreviewCoordinateSpace,
            RenderedFontSize = previewTextBlock.RenderedFontSize,
            SourceRenderedFontSize = sourceTextObject.SourceRenderedFontSize,
            LineHeightRatio = previewTextBlock.LineHeightRatio,
            SourceLineHeightRatio = sourceTextObject.SourceLineHeightRatio,
            PreviewViewportWidth = previewTextBlock.PreviewViewportWidth,
            SourcePreviewViewportWidth = sourceTextObject.SourcePreviewViewportWidth,
            PreviewViewportHeight = previewTextBlock.PreviewViewportHeight,
            SourcePreviewViewportHeight = sourceTextObject.SourcePreviewViewportHeight,
            LayoutContainerId = previewTextBlock.LayoutContainerId,
            SourceLayoutContainerId = sourceTextObject.SourceLayoutContainerId,
            EditableRunId = previewTextBlock.EditableRunId,
            SourceEditableRunId = sourceTextObject.SourceEditableRunId,
            DocumentEditMode = previewTextBlock.DocumentEditMode,
            SourceDocumentEditMode = sourceTextObject.SourceDocumentEditMode,
            PageEditMode = previewTextBlock.PageEditMode,
            SourcePageEditMode = sourceTextObject.SourcePageEditMode,
            MissingGlyphs = previewTextBlock.MissingGlyphs.ToArray(),
            SourceMissingGlyphs = sourceTextObject.SourceMissingGlyphs.ToArray(),
            LayoutLines = previewTextBlock.LayoutLines,
            SourceLayoutLines = sourceTextObject.SourceLayoutLines,
            PreviewLines = previewTextBlock.PreviewLines,
            SourcePreviewLines = sourceTextObject.SourcePreviewLines,
            PreviewBackgrounds = previewBackgrounds,
            SourcePreviewBackgrounds = sourceTextObject.SourcePreviewBackgrounds,
            IsOverlayObject = sourceTextObject.IsOverlayObject,
            HideSourceOnCommit = sourceTextObject.HideSourceOnCommit,
            UpdatedOnUtc = DateTime.UtcNow
        };
    }

    private static ToolSessionDetectedTextPreviewLineDto MapPreviewLine(DetectedPdfTextPreviewLine previewLine)
        => new()
        {
            Text = previewLine.Text,
            X = previewLine.X,
            Y = previewLine.Y,
            BaselineY = previewLine.BaselineY,
            FontSize = previewLine.FontSize,
            FontName = previewLine.FontName,
            ColorHex = previewLine.ColorHex,
            IsBold = previewLine.IsBold,
            IsItalic = previewLine.IsItalic,
            Spans = previewLine.Spans.Select(MapPreviewSpan).ToArray()
        };

    private static ToolSessionDetectedTextPreviewSpanDto MapPreviewSpan(DetectedPdfTextPreviewSpan previewSpan)
        => new()
        {
            Text = previewSpan.Text,
            X = previewSpan.X,
            Width = previewSpan.Width,
            FontSize = previewSpan.FontSize,
            FontName = previewSpan.FontName,
            ColorHex = previewSpan.ColorHex,
            IsBold = previewSpan.IsBold,
            IsItalic = previewSpan.IsItalic
        };

    private static ToolSessionDetectedTextPreviewBackgroundDto MapPreviewBackground(DetectedPdfTextPreviewBackground previewBackground)
        => new()
        {
            X = previewBackground.X,
            Y = previewBackground.Y,
            Width = previewBackground.Width,
            Height = previewBackground.Height,
            ColorHex = previewBackground.ColorHex,
            Opacity = previewBackground.Opacity
        };

    private static PdfTextOverlayOperation MapOverlayOperation(TemporaryPdfTextObject textObject)
        => new()
        {
            SourceTextBlockId = textObject.SourceTextBlockId,
            Text = textObject.Text,
            X = textObject.X,
            Y = textObject.Y,
            Width = textObject.Width,
            Height = textObject.Height,
            HideSourceOnCommit = textObject.HideSourceOnCommit,
            FontName = textObject.FontName,
            FontSize = textObject.FontSize,
            ColorHex = textObject.ColorHex,
            IsBold = textObject.IsBold,
            IsItalic = textObject.IsItalic,
            FontResourceName = textObject.FontResourceName,
            FontPostScriptName = textObject.FontPostScriptName,
            FontFamily = textObject.FontFamily,
            FontSource = textObject.FontSource,
            FontResolutionStatus = textObject.FontResolutionStatus,
            EditCapability = textObject.EditCapability,
            SaveCapability = textObject.SaveCapability,
            ToUnicodeAvailable = textObject.ToUnicodeAvailable,
            CanEmbedForEditing = textObject.CanEmbedForEditing,
            MissingGlyphs = textObject.MissingGlyphs.ToArray(),
            PreviewCoordinateSpace = textObject.PreviewCoordinateSpace,
            PreviewViewportWidth = textObject.PreviewViewportWidth,
            PreviewViewportHeight = textObject.PreviewViewportHeight,
            PreviewLines = textObject.PreviewLines.Select(ClonePreviewLine).ToArray()
        };

    private static bool RequiresExactSaveWarning(TemporaryPdfTextObject textObject)
        => !string.IsNullOrWhiteSpace(textObject.SaveCapability)
            && !string.Equals(textObject.SaveCapability, "exact-save", StringComparison.OrdinalIgnoreCase);

    private static DetectedPdfTextPreviewLine ClonePreviewLine(DetectedPdfTextPreviewLine previewLine)
        => new()
        {
            Text = previewLine.Text,
            X = previewLine.X,
            Y = previewLine.Y,
            BaselineY = previewLine.BaselineY,
            FontSize = previewLine.FontSize,
            FontName = previewLine.FontName,
            ColorHex = previewLine.ColorHex,
            IsBold = previewLine.IsBold,
            IsItalic = previewLine.IsItalic,
            Spans = previewLine.Spans.Select(ClonePreviewSpan).ToArray()
        };

    private static DetectedPdfTextPreviewSpan ClonePreviewSpan(DetectedPdfTextPreviewSpan previewSpan)
        => new()
        {
            Text = previewSpan.Text,
            X = previewSpan.X,
            Width = previewSpan.Width,
            FontSize = previewSpan.FontSize,
            FontName = previewSpan.FontName,
            ColorHex = previewSpan.ColorHex,
            IsBold = previewSpan.IsBold,
            IsItalic = previewSpan.IsItalic
        };

    private static string NormalizeColorHex(string? value, string fallback)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            var normalizedValue = value.Trim();
            if (System.Text.RegularExpressions.Regex.IsMatch(normalizedValue, "^#[0-9a-fA-F]{6}$"))
            {
                return normalizedValue;
            }
        }

        return fallback;
    }

    private static string BuildOverlayTextBlockId(Guid toolSessionTextObjectId)
        => $"overlay-{toolSessionTextObjectId:N}";

    private static string NormalizePreviewMode(string? previewMode)
    {
        if (string.IsNullOrWhiteSpace(previewMode))
        {
            return "source";
        }

        return previewMode.Trim().ToLowerInvariant() switch
        {
            "preview" => "preview",
            "preserved-source" => "preserved-source",
            "editing" => "editing",
            _ => "source"
        };
    }

    private static string NormalizePreviewCoordinateSpace(string? previewCoordinateSpace)
    {
        if (string.IsNullOrWhiteSpace(previewCoordinateSpace))
        {
            return "legacy-fitted";
        }

        return previewCoordinateSpace.Trim().ToLowerInvariant() switch
        {
            "exact-local" => "exact-local",
            _ => "legacy-fitted"
        };
    }

    private static string BuildOcrSummary(PdfOcrResult ocrResult)
    {
        var pageScope = string.IsNullOrWhiteSpace(ocrResult.PageRange) ? "all pages" : $"pages {ocrResult.PageRange}";
        var deskewSummary = ocrResult.Deskew ? "deskew enabled" : "deskew disabled";
        var forceSummary = ocrResult.ForceOcr ? "forced OCR" : "skip existing text";
        return $"Ran OCR on {pageScope} using {ocrResult.LanguageCode} ({deskewSummary}, {forceSummary}).";
    }

    private static IReadOnlyCollection<TemporaryPdfAnnotation> NormalizeAnnotations(IReadOnlyCollection<ToolSessionAnnotationInputDto> annotations)
    {
        var utcNow = DateTime.UtcNow;
        return annotations.Select(annotation =>
        {
            if (annotation.PageNumber <= 0)
            {
                throw new InvalidOperationException("Annotation page numbers must be greater than zero.");
            }

            if (!SupportedAnnotationTypes.Contains(annotation.AnnotationType, StringComparer.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException($"The annotation type \"{annotation.AnnotationType}\" is not supported yet.");
            }

            ValidateAnnotationPayload(annotation.AnnotationPayloadJson);

            return new TemporaryPdfAnnotation
            {
                ToolSessionAnnotationId = annotation.ToolSessionAnnotationId ?? Guid.NewGuid(),
                AnnotationType = annotation.AnnotationType.Trim(),
                PageNumber = annotation.PageNumber,
                AnnotationPayloadJson = annotation.AnnotationPayloadJson,
                UpdatedOnUtc = utcNow
            };
        }).ToArray();
    }

    private static IReadOnlyCollection<TemporaryPdfAnnotation> RotateAnnotations(
        IReadOnlyCollection<TemporaryPdfAnnotation> annotations,
        IReadOnlyCollection<int> pageNumbers,
        int degrees)
    {
        var pageNumberSet = pageNumbers.ToHashSet();
        return annotations.Select(annotation =>
            !pageNumberSet.Contains(annotation.PageNumber)
                ? annotation
                : new TemporaryPdfAnnotation
                {
                    ToolSessionAnnotationId = annotation.ToolSessionAnnotationId,
                    AnnotationType = annotation.AnnotationType,
                    PageNumber = annotation.PageNumber,
                    AnnotationPayloadJson = RotateAnnotationPayload(annotation.AnnotationType, annotation.AnnotationPayloadJson, degrees),
                    UpdatedOnUtc = DateTime.UtcNow
                }).ToArray();
    }

    private static IReadOnlyCollection<TemporaryPdfAnnotation> DeleteAnnotations(
        IReadOnlyCollection<TemporaryPdfAnnotation> annotations,
        IReadOnlyCollection<int> deletedPages)
    {
        var deletedPageSet = deletedPages.Distinct().OrderBy(pageNumber => pageNumber).ToArray();

        return annotations
            .Where(annotation => !deletedPageSet.Contains(annotation.PageNumber))
            .Select(annotation => new TemporaryPdfAnnotation
            {
                ToolSessionAnnotationId = annotation.ToolSessionAnnotationId,
                AnnotationType = annotation.AnnotationType,
                PageNumber = annotation.PageNumber - deletedPageSet.Count(deletedPage => deletedPage < annotation.PageNumber),
                AnnotationPayloadJson = annotation.AnnotationPayloadJson,
                UpdatedOnUtc = DateTime.UtcNow
            })
            .ToArray();
    }

    private static IReadOnlyCollection<TemporaryPdfAnnotation> ReorderAnnotations(
        IReadOnlyCollection<TemporaryPdfAnnotation> annotations,
        IReadOnlyCollection<int> orderedPageNumbers)
    {
        var pageNumberMap = orderedPageNumbers
            .Select((originalPageNumber, index) => new { originalPageNumber, reorderedPageNumber = index + 1 })
            .ToDictionary(item => item.originalPageNumber, item => item.reorderedPageNumber);

        return annotations.Select(annotation => new TemporaryPdfAnnotation
        {
            ToolSessionAnnotationId = annotation.ToolSessionAnnotationId,
            AnnotationType = annotation.AnnotationType,
            PageNumber = pageNumberMap.GetValueOrDefault(annotation.PageNumber, annotation.PageNumber),
            AnnotationPayloadJson = annotation.AnnotationPayloadJson,
            UpdatedOnUtc = DateTime.UtcNow
        }).ToArray();
    }

    private static string RotateAnnotationPayload(string annotationType, string annotationPayloadJson, int degrees)
    {
        var annotationPayload = JsonNode.Parse(annotationPayloadJson) as JsonObject;
        if (annotationPayload is null)
        {
            return annotationPayloadJson;
        }

        if (annotationType.Equals("Freehand", StringComparison.OrdinalIgnoreCase))
        {
            if (annotationPayload["points"] is not JsonArray pointArray)
            {
                return annotationPayloadJson;
            }

            foreach (var pointNode in pointArray.OfType<JsonObject>())
            {
                var transformedPoint = RotatePoint(
                    GetPayloadNumber(pointNode, "x"),
                    GetPayloadNumber(pointNode, "y"),
                    degrees);

                pointNode["x"] = transformedPoint.x;
                pointNode["y"] = transformedPoint.y;
            }

            return annotationPayload.ToJsonString();
        }

        var x = GetPayloadNumber(annotationPayload, "x");
        var y = GetPayloadNumber(annotationPayload, "y");
        var width = GetPayloadNumber(annotationPayload, "width");
        var height = GetPayloadNumber(annotationPayload, "height");

        (double x, double y, double width, double height) transformedBounds = degrees switch
        {
            90 => (1 - (y + height), x, height, width),
            180 => (1 - x - width, 1 - y - height, width, height),
            270 => (y, 1 - x - width, height, width),
            _ => (x, y, width, height)
        };

        annotationPayload["x"] = ClampUnit(transformedBounds.x);
        annotationPayload["y"] = ClampUnit(transformedBounds.y);
        annotationPayload["width"] = ClampUnit(transformedBounds.width);
        annotationPayload["height"] = ClampUnit(transformedBounds.height);

        return annotationPayload.ToJsonString();
    }

    private static (double x, double y) RotatePoint(double x, double y, int degrees) => degrees switch
    {
        90 => (ClampUnit(1 - y), ClampUnit(x)),
        180 => (ClampUnit(1 - x), ClampUnit(1 - y)),
        270 => (ClampUnit(y), ClampUnit(1 - x)),
        _ => (ClampUnit(x), ClampUnit(y))
    };

    private static double GetPayloadNumber(JsonObject payload, string propertyName)
    {
        if (payload[propertyName] is JsonValue valueNode &&
            valueNode.TryGetValue<double>(out var value))
        {
            return ClampUnit(value);
        }

        return 0;
    }

    private static double ClampUnit(double value) => Math.Min(Math.Max(value, 0), 1);

    private static void ValidateAnnotationPayload(string annotationPayloadJson)
    {
        try
        {
            using var _ = JsonDocument.Parse(annotationPayloadJson);
        }
        catch (JsonException)
        {
            throw new InvalidOperationException("Annotation data is invalid. Please try that change again.");
        }
    }

    private static void ValidatePdfUpload(string originalFileName, long fileLength)
    {
        if (fileLength <= 0)
        {
            throw new InvalidOperationException("Choose a non-empty PDF file to continue.");
        }

        if (!originalFileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Only PDF files are allowed.");
        }
    }

    private static IReadOnlyCollection<string> NormalizePageRanges(IReadOnlyCollection<string> pageRanges)
        => pageRanges
            .Select(pageRange => pageRange.Trim())
            .Where(pageRange => !string.IsNullOrWhiteSpace(pageRange))
            .Select(NormalizePageRange)
            .ToArray();

    private static string NormalizePageRange(string pageRange)
    {
        var segments = pageRange.Split('-', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

        if (segments.Length == 1 && int.TryParse(segments[0], out var singlePage) && singlePage > 0)
        {
            return singlePage.ToString();
        }

        if (segments.Length == 2 &&
            int.TryParse(segments[0], out var startPage) &&
            int.TryParse(segments[1], out var endPage) &&
            startPage > 0 &&
            endPage >= startPage)
        {
            return $"{startPage}-{endPage}";
        }

        throw new InvalidOperationException($"The page range \"{pageRange}\" is invalid. Use values like 1, 2-4, or 7-9.");
    }
}
