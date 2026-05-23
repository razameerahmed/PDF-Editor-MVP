using Microsoft.EntityFrameworkCore;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Domain.Entities;
using PdfEditor.Infrastructure.Persistence;

namespace PdfEditor.Infrastructure.Repositories;

public sealed class RefreshTokenRepository : IRefreshTokenRepository
{
    private readonly PdfEditorDbContext dbContext;

    public RefreshTokenRepository(PdfEditorDbContext dbContext) => this.dbContext = dbContext;

    public Task AddAsync(RefreshToken refreshToken, CancellationToken cancellationToken) =>
        dbContext.RefreshTokens.AddAsync(refreshToken, cancellationToken).AsTask();

    public Task<RefreshToken?> GetActiveTokenAsync(string token, CancellationToken cancellationToken) =>
        dbContext.RefreshTokens
            .Include(refreshToken => refreshToken.User)
            .SingleOrDefaultAsync(refreshToken => refreshToken.Token == token && refreshToken.RevokedOnUtc == null, cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken) => dbContext.SaveChangesAsync(cancellationToken);
}
