using PdfEditor.Contracts.Common;

namespace PdfEditor.Api.Common;

public static class ApiResponseFactory
{
    public static ApiResponse<T> Success<T>(T data, string message) =>
        new()
        {
            Success = true,
            Message = message,
            Data = data
        };

    public static ApiResponse<object?> Success(string message) =>
        new()
        {
            Success = true,
            Message = message,
            Data = null
        };

    public static ApiResponse<T?> Failure<T>(string message) =>
        new()
        {
            Success = false,
            Message = message,
            Data = default
        };
}
