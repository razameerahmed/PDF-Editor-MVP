namespace PdfEditor.Domain.Entities;

public sealed class AuditLog
{
    public Guid AuditLogId { get; set; }
    public Guid? UserId { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string EntityName { get; set; } = string.Empty;
    public string? EntityId { get; set; }
    public string EventDescription { get; set; } = string.Empty;
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public string AdditionalDataJson { get; set; } = "{}";
    public DateTime CreatedOnUtc { get; set; }
}
