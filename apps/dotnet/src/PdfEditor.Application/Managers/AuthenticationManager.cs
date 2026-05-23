using PdfEditor.Application.Abstractions;
using PdfEditor.Application.Common.Logging;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Contracts.Authentication;
using PdfEditor.Domain.Entities;
using PdfEditor.Domain.Enums;

namespace PdfEditor.Application.Managers;

public sealed class AuthenticationManager
{
    private readonly IUserRepository userRepository;
    private readonly IRefreshTokenRepository refreshTokenRepository;
    private readonly IAuditLogRepository auditLogRepository;
    private readonly IJwtTokenService jwtTokenService;
    private readonly IClock clock;

    public AuthenticationManager(
        IUserRepository userRepository,
        IRefreshTokenRepository refreshTokenRepository,
        IAuditLogRepository auditLogRepository,
        IJwtTokenService jwtTokenService,
        IClock clock)
    {
        this.userRepository = userRepository;
        this.refreshTokenRepository = refreshTokenRepository;
        this.auditLogRepository = auditLogRepository;
        this.jwtTokenService = jwtTokenService;
        this.clock = clock;
    }

    public async Task<AuthenticationResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Authentication login request received",
            action: "Login",
            result: "Started",
            updatedBy: string.Empty,
            description: $"EmailAddress={request.EmailAddress?.Trim()}");

        ValidateLoginRequest(request);

        var normalizedEmailAddress = request.EmailAddress!.Trim();
        var user = await userRepository.GetByEmailAddressAsync(normalizedEmailAddress, cancellationToken)
            ?? throw new UnauthorizedAccessException("Invalid email address or password.");

        if (!BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            throw new UnauthorizedAccessException("Invalid email address or password.");
        }

        var accessToken = jwtTokenService.CreateAccessToken(user);
        var refreshTokenValue = jwtTokenService.CreateRefreshToken();
        await refreshTokenRepository.AddAsync(new RefreshToken
        {
            RefreshTokenId = Guid.NewGuid(),
            UserId = user.UserId,
            Token = refreshTokenValue,
            CreatedOnUtc = clock.UtcNow,
            ExpiresOnUtc = clock.UtcNow.AddDays(7)
        }, cancellationToken);
        await auditLogRepository.AddAsync(new AuditLog
        {
            AuditLogId = Guid.NewGuid(),
            UserId = user.UserId,
            EventType = "UserLogin",
            EntityName = nameof(User),
            EntityId = user.UserId.ToString(),
            EventDescription = $"User '{user.EmailAddress}' logged in.",
            CreatedOnUtc = clock.UtcNow
        }, cancellationToken);
        await refreshTokenRepository.SaveChangesAsync(cancellationToken);

        AppLogger.Info(
            message: "Authentication login request completed successfully",
            action: "Login",
            result: "Succeeded",
            updatedBy: user.EmailAddress,
            description: $"UserId={user.UserId}");

        return new AuthenticationResponse(
            user.UserId,
            $"{user.FirstName} {user.LastName}".Trim(),
            user.EmailAddress,
            user.Role.ToString(),
            user.SubscriptionTier.ToString(),
            accessToken,
            refreshTokenValue,
            clock.UtcNow.AddMinutes(30));
    }

    public async Task<AuthenticationResponse> RegisterAsync(RegisterUserRequest request, CancellationToken cancellationToken)
    {
        AppLogger.Info(
            message: "Authentication registration request received",
            action: "Create",
            result: "Started",
            updatedBy: string.Empty,
            description: $"EmailAddress={request.EmailAddress?.Trim()}");

        ValidateRegistrationRequest(request);

        var normalizedEmailAddress = request.EmailAddress!.Trim().ToLowerInvariant();
        var existingUser = await userRepository.GetByEmailAddressAsync(normalizedEmailAddress, cancellationToken);
        if (existingUser is not null)
        {
            throw new InvalidOperationException("An account with that email address already exists.");
        }

        var utcNow = clock.UtcNow;
        var user = new User
        {
            UserId = Guid.NewGuid(),
            FirstName = request.FirstName.Trim(),
            LastName = request.LastName.Trim(),
            EmailAddress = normalizedEmailAddress,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = UserRole.Editor,
            SubscriptionTier = SubscriptionTier.Free,
            IsActive = true,
            CreatedOnUtc = utcNow,
            UpdatedOnUtc = utcNow
        };

        await userRepository.AddAsync(user, cancellationToken);
        await auditLogRepository.AddAsync(new AuditLog
        {
            AuditLogId = Guid.NewGuid(),
            UserId = user.UserId,
            EventType = "UserRegistered",
            EntityName = nameof(User),
            EntityId = user.UserId.ToString(),
            EventDescription = $"User '{user.EmailAddress}' registered.",
            CreatedOnUtc = utcNow
        }, cancellationToken);
        await userRepository.SaveChangesAsync(cancellationToken);

        AppLogger.Info(
            message: "Authentication registration request completed successfully",
            action: "Create",
            result: "Succeeded",
            updatedBy: user.EmailAddress,
            description: $"UserId={user.UserId}");

        return await LoginAsync(new LoginRequest(user.EmailAddress, request.Password), cancellationToken);
    }

    private static void ValidateLoginRequest(LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.EmailAddress))
        {
            throw new InvalidOperationException("Email address is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            throw new InvalidOperationException("Password is required.");
        }
    }

    private static void ValidateRegistrationRequest(RegisterUserRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.FirstName))
        {
            throw new InvalidOperationException("First name is required.");
        }

        if (string.IsNullOrWhiteSpace(request.LastName))
        {
            throw new InvalidOperationException("Last name is required.");
        }

        if (string.IsNullOrWhiteSpace(request.EmailAddress) || !request.EmailAddress.Contains('@'))
        {
            throw new InvalidOperationException("A valid email address is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 8)
        {
            throw new InvalidOperationException("Password must be at least 8 characters long.");
        }

        if (!string.Equals(request.Password, request.ConfirmPassword, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Password and confirmation password must match.");
        }
    }
}
