using PdfEditor.Domain.Entities;

namespace PdfEditor.Application.Abstractions;

public interface IJwtTokenService
{
    string CreateAccessToken(User user);
    string CreateRefreshToken();
}
