using PdfEditor.Domain.Common;
using PdfEditor.Domain.Enums;

namespace PdfEditor.Domain.Entities;

public sealed class User : AuditableEntity
{
    public Guid UserId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string EmailAddress { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public UserRole Role { get; set; }
    public SubscriptionTier SubscriptionTier { get; set; } = SubscriptionTier.Free;
    public bool IsActive { get; set; } = true;
    public DateTime? LastLoginOnUtc { get; set; }
    public ICollection<RefreshToken> RefreshTokens { get; set; } = [];
}
