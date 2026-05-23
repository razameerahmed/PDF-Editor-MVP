using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using PdfEditor.Application.Abstractions;
using PdfEditor.Domain.Entities;
using PdfEditor.Infrastructure.Configuration;

namespace PdfEditor.Infrastructure.Services;

public sealed class JwtTokenService : IJwtTokenService
{
    private const string SubscriptionTierClaimType = "subscription_tier";
    private readonly JwtOptions jwtOptions;

    public JwtTokenService(IOptions<JwtOptions> jwtOptions) => this.jwtOptions = jwtOptions.Value;

    public string CreateAccessToken(User user)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.UserId.ToString()),
            new Claim(ClaimTypes.Email, user.EmailAddress),
            new Claim(ClaimTypes.Role, user.Role.ToString()),
            new Claim(SubscriptionTierClaimType, user.SubscriptionTier.ToString())
        };

        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.SigningKey));
        var token = new JwtSecurityToken(
            jwtOptions.Issuer,
            jwtOptions.Audience,
            claims,
            expires: DateTime.UtcNow.AddMinutes(jwtOptions.AccessTokenMinutes),
            signingCredentials: new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256));

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string CreateRefreshToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(64));
}
