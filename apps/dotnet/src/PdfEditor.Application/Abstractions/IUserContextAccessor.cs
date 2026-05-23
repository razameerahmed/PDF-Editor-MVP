namespace PdfEditor.Application.Abstractions;

public interface IUserContextAccessor
{
    Guid GetRequiredUserId();
    string GetRequiredEmailAddress();
    string GetRequiredRole();
    string GetRequiredSubscriptionTier();
    bool IsPaidSubscriber();
}
