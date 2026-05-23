using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Contracts.Common;
using PdfEditor.Infrastructure.Configuration;
using PdfEditor.Infrastructure.Persistence;
using PdfEditor.Infrastructure.Repositories;
using PdfEditor.Infrastructure.Security;
using PdfEditor.Infrastructure.Services;

namespace PdfEditor.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<DatabaseStartupOptions>(configuration.GetSection("DatabaseStartup"));
        services.Configure<DocumentEngineOptions>(configuration.GetSection("DocumentEngine"));
        services.Configure<PdfToolsOptions>(configuration.GetSection("PdfTools"));
        services.Configure<StorageOptions>(configuration.GetSection("Storage"));
        services.Configure<JwtOptions>(configuration.GetSection("Jwt"));

        services.AddDbContext<PdfEditorDbContext>(options =>
            options.UseSqlServer(configuration.GetConnectionString("SqlServer")));

        services.AddHttpContextAccessor();
        services.AddScoped<IClock, SystemClock>();
        services.AddSingleton<IInstalledFontCatalogService, InstalledFontCatalogService>();
        services.AddScoped<IUserContextAccessor, ApiUserContextAccessor>();
        services.AddSingleton<IFileStorageService, LocalFileStorageService>();
        services.AddSingleton<ITemporaryPdfSessionService, TemporaryPdfSessionService>();
        services.AddSingleton<QpdfProcessService>();
        services.AddHttpClient<DocumentEngineHttpClient>((serviceProvider, client) =>
        {
            var options = serviceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<DocumentEngineOptions>>().Value;
            client.BaseAddress = new Uri(options.BaseUrl.TrimEnd('/'));
            client.Timeout = TimeSpan.FromSeconds(options.RequestTimeoutSeconds <= 0 ? 60 : options.RequestTimeoutSeconds);
        });
        services.AddScoped<IDocumentEngineService, DocumentEngineService>();
        services.AddScoped<IJwtTokenService, JwtTokenService>();
        services.AddScoped<IPdfAnnotationService, PdfAnnotationService>();
        services.AddScoped<IPdfCompressionService, PdfCompressionService>();
        services.AddScoped<IPdfDocumentProcessingService, PdfDocumentProcessingService>();
        services.AddScoped<IPdfTextEditingService, PdfTextEditingService>();

        services.AddScoped<IAuditLogRepository, AuditLogRepository>();
        services.AddScoped<IDocumentAnnotationRepository, DocumentAnnotationRepository>();
        services.AddScoped<IDocumentJobRepository, DocumentJobRepository>();
        services.AddScoped<IDocumentRepository, DocumentRepository>();
        services.AddScoped<IDocumentVersionRepository, DocumentVersionRepository>();
        services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<DevelopmentDatabaseInitializer>();
        services.AddScoped<DatabaseStartupValidator>();
        services.AddScoped<DocumentEngineStartupValidator>();

        var jwtOptions = configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateIssuerSigningKey = true,
                    ValidateLifetime = true,
                    ValidIssuer = jwtOptions.Issuer,
                    ValidAudience = jwtOptions.Audience,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.SigningKey))
                };
                options.Events = new JwtBearerEvents
                {
                    OnChallenge = async context =>
                    {
                        context.HandleResponse();

                        AppLogger.Warn(
                            message: "API request was unauthorized because the access token challenge failed",
                            action: context.Request.Method,
                            result: "Unauthorized",
                            updatedBy: string.Empty,
                            description: context.Request.Path);

                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        context.Response.ContentType = "application/json";
                        await context.Response.WriteAsJsonAsync(new ApiResponse<object?>
                        {
                            Success = false,
                            Message = "You are not authorized to perform this action.",
                            Data = null
                        });
                    },
                    OnForbidden = async context =>
                    {
                        AppLogger.Warn(
                            message: "API request was forbidden because the authenticated user does not have access",
                            action: context.Request.Method,
                            result: "Forbidden",
                            updatedBy: string.Empty,
                            description: context.Request.Path);

                        context.Response.StatusCode = StatusCodes.Status403Forbidden;
                        context.Response.ContentType = "application/json";
                        await context.Response.WriteAsJsonAsync(new ApiResponse<object?>
                        {
                            Success = false,
                            Message = "You do not have permission to perform this action.",
                            Data = null
                        });
                    }
                };
            });

        return services;
    }
}
