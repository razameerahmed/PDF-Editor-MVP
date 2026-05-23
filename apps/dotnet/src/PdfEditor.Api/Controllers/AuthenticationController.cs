using Microsoft.AspNetCore.Mvc;
using PdfEditor.Api.Common;
using PdfEditor.Application.Managers;
using PdfEditor.Contracts.Authentication;

namespace PdfEditor.Api.Controllers;

[ApiController]
[Route("api/v1/auth")]
public sealed class AuthenticationController : ApiControllerBase
{
    private readonly AuthenticationManager authenticationManager;

    public AuthenticationController(AuthenticationManager authenticationManager) => this.authenticationManager = authenticationManager;

    [HttpPost("login")]
    public async Task<IActionResult> LoginAsync([FromBody] LoginRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => authenticationManager.LoginAsync(request, cancellationToken),
            "Login completed successfully.",
            "Login",
            $"EmailAddress={request.EmailAddress?.Trim()}");

    [HttpPost("signup")]
    public async Task<IActionResult> RegisterAsync([FromBody] RegisterUserRequest request, CancellationToken cancellationToken)
        => await ExecuteAsync(
            () => authenticationManager.RegisterAsync(request, cancellationToken),
            "Account created successfully.",
            "Create",
            $"EmailAddress={request.EmailAddress?.Trim()}");

    [HttpPost("refresh-token")]
    public IActionResult RefreshToken([FromBody] RefreshTokenRequest request)
        => Accepted(ApiResponseFactory.Success<object?>(
            new { request.RefreshToken },
            "Refresh token workflow is not implemented yet."));

    [HttpPost("logout")]
    public IActionResult Logout([FromBody] LogoutRequest request)
        => Ok(ApiResponseFactory.Success("Logout completed successfully."));
}
