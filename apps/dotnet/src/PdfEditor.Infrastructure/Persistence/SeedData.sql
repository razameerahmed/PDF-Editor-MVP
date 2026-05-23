USE PdfEditorMvp;
GO

/*
The application auto-seeds demo users and sample data on first startup through
DevelopmentDatabaseInitializer. Use these credentials after starting the API:

  owner@pdfeditor.local  / Password123!
  editor@pdfeditor.local / Password123!
  viewer@pdfeditor.local / Password123!

If you want SQL-only seeding, replace the PasswordHash values below with valid
BCrypt hashes and then run the INSERT statements.
*/

-- Example manual seed template:
-- INSERT INTO Users (UserId, FirstName, LastName, EmailAddress, PasswordHash, Role, IsActive, CreatedOnUtc, UpdatedOnUtc)
-- VALUES
-- ('11111111-1111-1111-1111-111111111111', 'Olivia', 'Owner', 'owner@pdfeditor.local', '<bcrypt-hash>', 1, 1, SYSUTCDATETIME(), SYSUTCDATETIME());
