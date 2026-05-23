namespace PdfEditor.Contracts.Authentication;

public sealed record AuthenticationResponse(
    Guid UserId,
    string DisplayName,
    string EmailAddress,
    string Role,
    string SubscriptionTier,
    string AccessToken,
    string RefreshToken,
    DateTime ExpiresOnUtc);
