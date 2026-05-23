using PdfEditor.Domain.Entities;

namespace PdfEditor.Application.Abstractions.Repositories;

public interface IAuditLogRepository
{
    Task AddAsync(AuditLog auditLog, CancellationToken cancellationToken);
    Task<IReadOnlyCollection<AuditLog>> GetRecentAsync(int takeCount, CancellationToken cancellationToken);
}
