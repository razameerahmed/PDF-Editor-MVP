using Microsoft.EntityFrameworkCore;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Domain.Entities;
using PdfEditor.Infrastructure.Persistence;

namespace PdfEditor.Infrastructure.Repositories;

public sealed class AuditLogRepository : IAuditLogRepository
{
    private readonly PdfEditorDbContext dbContext;

    public AuditLogRepository(PdfEditorDbContext dbContext) => this.dbContext = dbContext;

    public Task AddAsync(AuditLog auditLog, CancellationToken cancellationToken) =>
        dbContext.AuditLogs.AddAsync(auditLog, cancellationToken).AsTask();

    public async Task<IReadOnlyCollection<AuditLog>> GetRecentAsync(int takeCount, CancellationToken cancellationToken) =>
        await dbContext.AuditLogs.AsNoTracking()
            .OrderByDescending(auditLog => auditLog.CreatedOnUtc)
            .Take(takeCount)
            .ToListAsync(cancellationToken);
}
