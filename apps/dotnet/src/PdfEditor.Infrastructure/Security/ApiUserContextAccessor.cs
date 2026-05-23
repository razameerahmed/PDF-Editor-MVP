using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using PdfEditor.Application.Abstractions;

namespace PdfEditor.Infrastructure.Security;

public sealed class ApiUserContextAccessor : IUserContextAccessor
{
    private const string SubscriptionTierClaimType = "subscription_tier";
    private readonly IHttpContextAccessor httpContextAccessor;

    public ApiUserContextAccessor(IHttpContextAccessor httpContextAccessor) => this.httpContextAccessor = httpContextAccessor;

    public Guid GetRequiredUserId() =>
        Guid.Parse(httpContextAccessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? Guid.Empty.ToString());

    public string GetRequiredEmailAddress() =>
        httpContextAccessor.HttpContext?.User.FindFirstValue(ClaimTypes.Email) ?? string.Empty;

    public string GetRequiredRole() =>
        httpContextAccessor.HttpContext?.User.FindFirstValue(ClaimTypes.Role) ?? string.Empty;

    public string GetRequiredSubscriptionTier() =>
        httpContextAccessor.HttpContext?.User.FindFirstValue(SubscriptionTierClaimType) ?? string.Empty;

    public bool IsPaidSubscriber() =>
        string.Equals(GetRequiredSubscriptionTier(), "Paid", StringComparison.OrdinalIgnoreCase);
}
