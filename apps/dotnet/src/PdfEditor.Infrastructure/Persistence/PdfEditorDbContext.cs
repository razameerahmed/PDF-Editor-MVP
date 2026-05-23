using Microsoft.EntityFrameworkCore;
using PdfEditor.Domain.Entities;

namespace PdfEditor.Infrastructure.Persistence;

public sealed class PdfEditorDbContext : DbContext
{
    public PdfEditorDbContext(DbContextOptions<PdfEditorDbContext> options)
        : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<DocumentVersion> DocumentVersions => Set<DocumentVersion>();
    public DbSet<DocumentAnnotation> DocumentAnnotations => Set<DocumentAnnotation>();
    public DbSet<DocumentJob> DocumentJobs => Set<DocumentJob>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>().HasKey(entity => entity.UserId);
        modelBuilder.Entity<RefreshToken>().HasKey(entity => entity.RefreshTokenId);
        modelBuilder.Entity<Document>().HasKey(entity => entity.DocumentId);
        modelBuilder.Entity<DocumentVersion>().HasKey(entity => entity.DocumentVersionId);
        modelBuilder.Entity<DocumentAnnotation>().HasKey(entity => entity.DocumentAnnotationId);
        modelBuilder.Entity<DocumentJob>().HasKey(entity => entity.DocumentJobId);
        modelBuilder.Entity<AuditLog>().HasKey(entity => entity.AuditLogId);

        modelBuilder.Entity<User>().HasIndex(entity => entity.EmailAddress).IsUnique();
        modelBuilder.Entity<Document>().HasIndex(entity => new { entity.Title, entity.IsDeleted });
        modelBuilder.Entity<DocumentVersion>().HasIndex(entity => new { entity.DocumentId, entity.VersionNumber }).IsUnique();
        modelBuilder.Entity<DocumentJob>().HasIndex(entity => new { entity.DocumentId, entity.JobStatus });
        modelBuilder.Entity<AuditLog>().HasIndex(entity => entity.CreatedOnUtc);

        modelBuilder.Entity<Document>().Property(entity => entity.RowVersion).IsRowVersion();
    }
}
