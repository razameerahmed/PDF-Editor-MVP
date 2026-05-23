using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using PdfEditor.Api.Common;
using PdfEditor.Application;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Contracts.Common;
using PdfEditor.Infrastructure;
using PdfEditor.Infrastructure.Persistence;
using PdfEditor.Infrastructure.Services;

AppLogger.Configure(Path.Combine(AppContext.BaseDirectory, "nlog.config"));

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddControllers();
builder.Services.AddAuthorization();
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});
builder.Services.Configure<ApiBehaviorOptions>(options =>
{
    options.InvalidModelStateResponseFactory = context =>
    {
        var validationErrors = context.ModelState.Values
            .SelectMany(modelState => modelState.Errors)
            .Select(error => string.IsNullOrWhiteSpace(error.ErrorMessage) ? "One or more validation errors occurred." : error.ErrorMessage)
            .Distinct()
            .ToArray();

        var message = validationErrors.Length == 0
            ? "One or more validation errors occurred."
            : string.Join(" ", validationErrors);

        AppLogger.Warn(
            message: "Request validation failed before reaching the controller action",
            action: "Validate",
            result: "ValidationFailed",
            updatedBy: string.Empty,
            description: $"{context.HttpContext.Request.Method} {context.HttpContext.Request.Path}");

        return new BadRequestObjectResult(ApiResponseFactory.Failure<object?>(message));
    };
});
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var databaseStartupValidator = scope.ServiceProvider.GetRequiredService<DatabaseStartupValidator>();
    await databaseStartupValidator.ValidateAsync(CancellationToken.None);

    var documentEngineStartupValidator = scope.ServiceProvider.GetRequiredService<DocumentEngineStartupValidator>();
    await documentEngineStartupValidator.ValidateAsync(CancellationToken.None);
}

app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
        var (statusCode, message, result) = exception switch
        {
            InvalidOperationException => (StatusCodes.Status400BadRequest, exception!.Message, "ValidationFailed"),
            KeyNotFoundException => (StatusCodes.Status404NotFound, exception!.Message, "NotFound"),
            UnauthorizedAccessException => (StatusCodes.Status401Unauthorized, "You are not authorized to perform this action.", "Unauthorized"),
            _ => (StatusCodes.Status500InternalServerError, "Something went wrong.", "Failed")
        };

        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json";

        if (statusCode >= StatusCodes.Status500InternalServerError)
        {
            AppLogger.Error(
                message: "Unhandled exception reached the global exception handler",
                action: context.Request.Method,
                result: result,
                updatedBy: string.Empty,
                description: context.Request.Path,
                exception: exception);
        }
        else
        {
            AppLogger.Warn(
                message: "Request completed through the global exception handler",
                action: context.Request.Method,
                result: result,
                updatedBy: string.Empty,
                description: context.Request.Path,
                exception: exception);
        }

        await context.Response.WriteAsJsonAsync(new ApiResponse<object?>
        {
            Success = false,
            Message = message,
            Data = null
        });
    });
});

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        context.Context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        context.Context.Response.Headers.Pragma = "no-cache";
        context.Context.Response.Headers.Expires = "0";
    }
});
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
void MapStaticPage(string route, string relativeFilePath)
{
    app.MapGet(route, async (HttpContext context, IWebHostEnvironment environment) =>
    {
        var fullPath = Path.Combine(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"), relativeFilePath);
        var html = await File.ReadAllTextAsync(fullPath);
        context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        context.Response.Headers.Pragma = "no-cache";
        context.Response.Headers.Expires = "0";
        return Results.Content(html, "text/html");
    });
}

MapStaticPage("/compress", "compress/index.html");
MapStaticPage("/merge", "merge/index.html");
MapStaticPage("/split", "split/index.html");
MapStaticPage("/edit", "edit/index.html");
MapStaticPage("/unlock", "unlock/index.html");
MapStaticPage("/annotations", "edit/index.html");
MapStaticPage("/rotate-pages", "edit/index.html");
MapStaticPage("/delete-pages", "edit/index.html");
MapStaticPage("/reorder-pages", "edit/index.html");
MapStaticPage("/all-tools", "all-tools/index.html");
MapStaticPage("/login", "login/index.html");
MapStaticPage("/signup", "signup/index.html");
app.Run();

public partial class Program;
