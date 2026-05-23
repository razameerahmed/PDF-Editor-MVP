using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using PdfEditor.Api.Common;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Contracts.Common;
using PdfEditor.Contracts.Documents;

namespace PdfEditor.Api.Controllers;

public abstract class ApiControllerBase : ControllerBase
{
    protected async Task<IActionResult> ExecuteAsync<T>(
        Func<Task<T>> action,
        string successMessage,
        string actionName,
        string description,
        Func<T, IActionResult>? successResultFactory = null)
    {
        AppLogger.Info(
            message: $"{GetRequestLabel()} request received",
            action: actionName,
            result: "Started",
            updatedBy: GetUpdatedBy(),
            description: description);

        try
        {
            var data = await action();

            AppLogger.Info(
                message: $"{GetRequestLabel()} request completed successfully",
                action: actionName,
                result: "Succeeded",
                updatedBy: GetUpdatedBy(),
                description: description);

            return successResultFactory is null
                ? Ok(ApiResponseFactory.Success(data, successMessage))
                : successResultFactory(data);
        }
        catch (InvalidOperationException exception)
        {
            return CreateHandledErrorResult<T>(StatusCodes.Status400BadRequest, exception.Message, actionName, "ValidationFailed", description, exception);
        }
        catch (KeyNotFoundException exception)
        {
            return CreateHandledErrorResult<T>(StatusCodes.Status404NotFound, exception.Message, actionName, "NotFound", description, exception);
        }
        catch (UnauthorizedAccessException exception)
        {
            return CreateHandledErrorResult<T>(
                StatusCodes.Status401Unauthorized,
                "You are not authorized to perform this action.",
                actionName,
                "Unauthorized",
                description,
                exception);
        }
        catch (Exception exception)
        {
            return CreateHandledErrorResult<T>(
                StatusCodes.Status500InternalServerError,
                "Something went wrong.",
                actionName,
                "Failed",
                description,
                exception);
        }
    }

    protected async Task<IActionResult> ExecuteNoDataAsync(
        Func<Task> action,
        string successMessage,
        string actionName,
        string description,
        Func<IActionResult>? successResultFactory = null)
    {
        AppLogger.Info(
            message: $"{GetRequestLabel()} request received",
            action: actionName,
            result: "Started",
            updatedBy: GetUpdatedBy(),
            description: description);

        try
        {
            await action();

            AppLogger.Info(
                message: $"{GetRequestLabel()} request completed successfully",
                action: actionName,
                result: "Succeeded",
                updatedBy: GetUpdatedBy(),
                description: description);

            return successResultFactory is null
                ? Ok(ApiResponseFactory.Success(successMessage))
                : successResultFactory();
        }
        catch (InvalidOperationException exception)
        {
            return CreateHandledErrorResult<object?>(StatusCodes.Status400BadRequest, exception.Message, actionName, "ValidationFailed", description, exception);
        }
        catch (KeyNotFoundException exception)
        {
            return CreateHandledErrorResult<object?>(StatusCodes.Status404NotFound, exception.Message, actionName, "NotFound", description, exception);
        }
        catch (UnauthorizedAccessException exception)
        {
            return CreateHandledErrorResult<object?>(
                StatusCodes.Status401Unauthorized,
                "You are not authorized to perform this action.",
                actionName,
                "Unauthorized",
                description,
                exception);
        }
        catch (Exception exception)
        {
            return CreateHandledErrorResult<object?>(
                StatusCodes.Status500InternalServerError,
                "Something went wrong.",
                actionName,
                "Failed",
                description,
                exception);
        }
    }

    protected async Task<IActionResult> ExecuteFileAsync(
        Func<Task<DocumentDownloadDto>> action,
        string actionName,
        string description,
        bool downloadFileNameRequired = true,
        bool enableRangeProcessing = false)
    {
        AppLogger.Info(
            message: $"{GetRequestLabel()} file request received",
            action: actionName,
            result: "Started",
            updatedBy: GetUpdatedBy(),
            description: description);

        try
        {
            var file = await action();

            AppLogger.Info(
                message: $"{GetRequestLabel()} file request completed successfully",
                action: actionName,
                result: "Succeeded",
                updatedBy: GetUpdatedBy(),
                description: description);

            return downloadFileNameRequired
                ? File(file.ContentStream, file.MimeType, file.FileName)
                : File(file.ContentStream, file.MimeType, enableRangeProcessing: enableRangeProcessing);
        }
        catch (InvalidOperationException exception)
        {
            return CreateHandledErrorResult<object?>(StatusCodes.Status400BadRequest, exception.Message, actionName, "ValidationFailed", description, exception);
        }
        catch (KeyNotFoundException exception)
        {
            return CreateHandledErrorResult<object?>(StatusCodes.Status404NotFound, exception.Message, actionName, "NotFound", description, exception);
        }
        catch (UnauthorizedAccessException exception)
        {
            return CreateHandledErrorResult<object?>(
                StatusCodes.Status401Unauthorized,
                "You are not authorized to perform this action.",
                actionName,
                "Unauthorized",
                description,
                exception);
        }
        catch (Exception exception)
        {
            return CreateHandledErrorResult<object?>(
                StatusCodes.Status500InternalServerError,
                "Something went wrong.",
                actionName,
                "Failed",
                description,
                exception);
        }
    }

    protected IActionResult CreatedResponse<T>(string location, T data, string message) =>
        Created(location, ApiResponseFactory.Success(data, message));

    private IActionResult CreateHandledErrorResult<T>(
        int statusCode,
        string userMessage,
        string actionName,
        string result,
        string description,
        Exception exception)
    {
        if (statusCode >= StatusCodes.Status500InternalServerError)
        {
            AppLogger.Error(
                message: $"{GetRequestLabel()} request failed with unexpected exception",
                action: actionName,
                result: result,
                updatedBy: GetUpdatedBy(),
                description: description,
                exception: exception);
        }
        else
        {
            AppLogger.Warn(
                message: $"{GetRequestLabel()} request did not complete successfully",
                action: actionName,
                result: result,
                updatedBy: GetUpdatedBy(),
                description: description,
                exception: exception);
        }

        return StatusCode(statusCode, ApiResponseFactory.Failure<T>(userMessage));
    }

    private string GetRequestLabel()
    {
        var controllerName = ControllerContext.ActionDescriptor.ControllerName ?? GetType().Name;
        var actionName = ControllerContext.ActionDescriptor.ActionName ?? "UnknownAction";
        return $"{controllerName}.{actionName}";
    }

    private string GetUpdatedBy()
    {
        if (User?.Identity?.IsAuthenticated != true)
        {
            return string.Empty;
        }

        return User.FindFirst(ClaimTypes.Email)?.Value
            ?? User.FindFirst(ClaimTypes.Name)?.Value
            ?? User.Identity?.Name
            ?? string.Empty;
    }
}
