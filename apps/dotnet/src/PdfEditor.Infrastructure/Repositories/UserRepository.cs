using Microsoft.EntityFrameworkCore;
using PdfEditor.Application.Abstractions.Repositories;
using PdfEditor.Domain.Entities;
using PdfEditor.Infrastructure.Persistence;

namespace PdfEditor.Infrastructure.Repositories;

public sealed class UserRepository : IUserRepository
{
    private readonly PdfEditorDbContext dbContext;

    public UserRepository(PdfEditorDbContext dbContext) => this.dbContext = dbContext;

    public Task AddAsync(User user, CancellationToken cancellationToken) =>
        dbContext.Users.AddAsync(user, cancellationToken).AsTask();

    public Task<User?> GetByEmailAddressAsync(string emailAddress, CancellationToken cancellationToken) =>
        dbContext.Users.SingleOrDefaultAsync(user => user.EmailAddress == emailAddress, cancellationToken);

    public Task<User?> GetByIdAsync(Guid userId, CancellationToken cancellationToken) =>
        dbContext.Users.SingleOrDefaultAsync(user => user.UserId == userId, cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken) => dbContext.SaveChangesAsync(cancellationToken);
}
