namespace PdfEditor.Worker;

public sealed class DocumentJobWorker : BackgroundService
{
    private readonly ILogger<DocumentJobWorker> logger;

    public DocumentJobWorker(ILogger<DocumentJobWorker> logger) => this.logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            logger.LogInformation("Document job worker heartbeat at {UtcNow}.", DateTime.UtcNow);
            await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
        }
    }
}
