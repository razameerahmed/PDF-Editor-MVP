using Microsoft.Extensions.DependencyInjection;
using PdfEditor.Application.Managers;

namespace PdfEditor.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<AuthenticationManager>();
        services.AddScoped<DocumentAnnotationManager>();
        services.AddScoped<DocumentCompressionManager>();
        services.AddScoped<DocumentManager>();
        services.AddScoped<DocumentPageOperationManager>();
        services.AddScoped<EditorResourceManager>();
        services.AddScoped<ToolSessionManager>();
        return services;
    }
}
