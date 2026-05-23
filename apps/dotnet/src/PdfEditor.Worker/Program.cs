using PdfEditor.Application;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Infrastructure;
using PdfEditor.Worker;

AppLogger.Configure(Path.Combine(AppContext.BaseDirectory, "nlog.config"));

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddHostedService<DocumentJobWorker>();

var host = builder.Build();

await using (var scope = host.Services.CreateAsyncScope())
{
    var databaseStartupValidator = scope.ServiceProvider.GetRequiredService<PdfEditor.Infrastructure.Services.DatabaseStartupValidator>();
    await databaseStartupValidator.ValidateAsync(CancellationToken.None);

    var documentEngineStartupValidator = scope.ServiceProvider.GetRequiredService<PdfEditor.Infrastructure.Services.DocumentEngineStartupValidator>();
    await documentEngineStartupValidator.ValidateAsync(CancellationToken.None);
}

host.Run();
