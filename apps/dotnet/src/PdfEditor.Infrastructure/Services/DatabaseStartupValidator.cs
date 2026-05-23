using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Infrastructure.Configuration;
using PdfEditor.Infrastructure.Persistence;

namespace PdfEditor.Infrastructure.Services;

public sealed class DatabaseStartupValidator
{
    private static readonly string[] RequiredTables =
    [
        "Users",
        "RefreshTokens",
        "Documents",
        "DocumentVersions",
        "DocumentAnnotations",
        "DocumentJobs",
        "AuditLogs"
    ];

    private readonly PdfEditorDbContext dbContext;
    private readonly DevelopmentDatabaseInitializer databaseInitializer;
    private readonly DatabaseStartupOptions options;

    public DatabaseStartupValidator(
        PdfEditorDbContext dbContext,
        DevelopmentDatabaseInitializer databaseInitializer,
        IOptions<DatabaseStartupOptions> options)
    {
        this.dbContext = dbContext;
        this.databaseInitializer = databaseInitializer;
        this.options = options.Value;
    }

    public async Task ValidateAsync(CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Database startup validation request received",
            action: "Validate",
            result: "Started",
            updatedBy: string.Empty,
            description: "Checking SQL Server connectivity and required tables.");

        var connectionString = dbContext.Database.GetConnectionString();
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("The SQL Server connection string is missing. Set ConnectionStrings:SqlServer before starting the application.");
        }

        try
        {
            if (!await dbContext.Database.CanConnectAsync(cancellationToken))
            {
                throw new InvalidOperationException("The application could not connect to the configured SQL Server database.");
            }
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException("Database startup validation failed. Check the SQL Server connection string, server availability, and credentials.", exception);
        }

        if (options.AutoInitializeSchema)
        {
            await dbContext.Database.EnsureCreatedAsync(cancellationToken);
        }

        var missingTables = await GetMissingTablesAsync(cancellationToken);
        if (missingTables.Count > 0)
        {
            throw new InvalidOperationException($"Database startup validation failed. The configured database is reachable but missing required tables: {string.Join(", ", missingTables)}.");
        }

        await EnsureSubscriptionTierColumnAsync(cancellationToken);

        if (options.SeedDemoData)
        {
            await databaseInitializer.InitializeAsync(cancellationToken);
        }

        AppLogger.Info(
            message: "Database startup validation completed successfully",
            action: "Validate",
            result: "Succeeded",
            updatedBy: string.Empty,
            description: $"SeedDemoData={options.SeedDemoData}, AutoInitializeSchema={options.AutoInitializeSchema}");
    }

    private async Task<IReadOnlyCollection<string>> GetMissingTablesAsync(CancellationToken cancellationToken)
    {
        var connection = dbContext.Database.GetDbConnection();
        var shouldCloseConnection = connection.State != System.Data.ConnectionState.Open;
        if (shouldCloseConnection)
        {
            await connection.OpenAsync(cancellationToken);
        }

        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'";

            var existingTables = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                existingTables.Add(reader.GetString(0));
            }

            return RequiredTables.Where(tableName => !existingTables.Contains(tableName)).ToArray();
        }
        finally
        {
            if (shouldCloseConnection)
            {
                await connection.CloseAsync();
            }
        }
    }

    private async Task EnsureSubscriptionTierColumnAsync(CancellationToken cancellationToken)
    {
        var connection = dbContext.Database.GetDbConnection();
        var shouldCloseConnection = connection.State != System.Data.ConnectionState.Open;
        if (shouldCloseConnection)
        {
            await connection.OpenAsync(cancellationToken);
        }

        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = """
                IF COL_LENGTH('Users', 'SubscriptionTier') IS NULL
                BEGIN
                    ALTER TABLE [Users]
                    ADD [SubscriptionTier] int NOT NULL
                        CONSTRAINT [DF_Users_SubscriptionTier] DEFAULT 1;
                END
                """;

            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        finally
        {
            if (shouldCloseConnection)
            {
                await connection.CloseAsync();
            }
        }
    }
}
