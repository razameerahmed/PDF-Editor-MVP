namespace PdfEditor.Domain.Entities;

public sealed class RefreshToken
{
    public Guid RefreshTokenId { get; set; }
    public Guid UserId { get; set; }
    public string Token { get; set; } = string.Empty;
    public DateTime ExpiresOnUtc { get; set; }
    public DateTime? RevokedOnUtc { get; set; }
    public DateTime CreatedOnUtc { get; set; }
    public string? ReplacedByToken { get; set; }
    public string? ReasonRevoked { get; set; }
    public User User { get; set; } = null!;
}
