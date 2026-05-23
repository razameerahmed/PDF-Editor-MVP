IF DB_ID('PdfEditorMvp') IS NULL
BEGIN
    CREATE DATABASE PdfEditorMvp;
END
GO

USE PdfEditorMvp;
GO

CREATE TABLE Users (
    UserId uniqueidentifier NOT NULL PRIMARY KEY,
    FirstName nvarchar(100) NOT NULL,
    LastName nvarchar(100) NOT NULL,
    EmailAddress nvarchar(256) NOT NULL,
    PasswordHash nvarchar(512) NOT NULL,
    Role int NOT NULL,
    IsActive bit NOT NULL,
    LastLoginOnUtc datetime2 NULL,
    CreatedOnUtc datetime2 NOT NULL,
    UpdatedOnUtc datetime2 NOT NULL
);
GO

CREATE UNIQUE INDEX IX_Users_EmailAddress ON Users (EmailAddress);
GO

CREATE TABLE RefreshTokens (
    RefreshTokenId uniqueidentifier NOT NULL PRIMARY KEY,
    UserId uniqueidentifier NOT NULL,
    Token nvarchar(256) NOT NULL,
    ExpiresOnUtc datetime2 NOT NULL,
    RevokedOnUtc datetime2 NULL,
    CreatedOnUtc datetime2 NOT NULL,
    ReplacedByToken nvarchar(256) NULL,
    ReasonRevoked nvarchar(512) NULL,
    CONSTRAINT FK_RefreshTokens_Users_UserId FOREIGN KEY (UserId) REFERENCES Users(UserId)
);
GO

CREATE TABLE Documents (
    DocumentId uniqueidentifier NOT NULL PRIMARY KEY,
    OriginalFileName nvarchar(260) NOT NULL,
    StoredFileName nvarchar(260) NOT NULL,
    FileExtension nvarchar(16) NOT NULL,
    MimeType nvarchar(128) NOT NULL,
    FileSizeInBytes bigint NOT NULL,
    CurrentVersionNumber int NOT NULL,
    DocumentStatus int NOT NULL,
    Title nvarchar(256) NOT NULL,
    Description nvarchar(1000) NULL,
    UploadedByUserId uniqueidentifier NOT NULL,
    StorageProvider nvarchar(64) NOT NULL,
    StoragePath nvarchar(512) NOT NULL,
    ChecksumSha256 nvarchar(128) NOT NULL,
    IsDeleted bit NOT NULL,
    CreatedOnUtc datetime2 NOT NULL,
    UpdatedOnUtc datetime2 NOT NULL,
    CreatedByUserId uniqueidentifier NULL,
    UpdatedByUserId uniqueidentifier NULL,
    RowVersion rowversion NOT NULL,
    CONSTRAINT FK_Documents_Users_UploadedByUserId FOREIGN KEY (UploadedByUserId) REFERENCES Users(UserId)
);
GO

CREATE INDEX IX_Documents_Title_IsDeleted ON Documents (Title, IsDeleted);
GO

CREATE TABLE DocumentVersions (
    DocumentVersionId uniqueidentifier NOT NULL PRIMARY KEY,
    DocumentId uniqueidentifier NOT NULL,
    VersionNumber int NOT NULL,
    VersionLabel nvarchar(256) NOT NULL,
    VersionStatus int NOT NULL,
    StoredFileName nvarchar(260) NOT NULL,
    StoragePath nvarchar(512) NOT NULL,
    FileSizeInBytes bigint NOT NULL,
    ChecksumSha256 nvarchar(128) NOT NULL,
    SourceJobId uniqueidentifier NULL,
    ChangeSummary nvarchar(1000) NULL,
    IsCurrentVersion bit NOT NULL,
    CreatedByUserId uniqueidentifier NOT NULL,
    CreatedOnUtc datetime2 NOT NULL,
    CONSTRAINT FK_DocumentVersions_Documents_DocumentId FOREIGN KEY (DocumentId) REFERENCES Documents(DocumentId),
    CONSTRAINT UQ_DocumentVersions_DocumentId_VersionNumber UNIQUE (DocumentId, VersionNumber)
);
GO

CREATE TABLE DocumentAnnotations (
    DocumentAnnotationId uniqueidentifier NOT NULL PRIMARY KEY,
    DocumentId uniqueidentifier NOT NULL,
    DocumentVersionId uniqueidentifier NOT NULL,
    AnnotationType nvarchar(64) NOT NULL,
    PageNumber int NOT NULL,
    AnnotationPayloadJson nvarchar(max) NOT NULL,
    CreatedByUserId uniqueidentifier NULL,
    UpdatedByUserId uniqueidentifier NULL,
    CreatedOnUtc datetime2 NOT NULL,
    UpdatedOnUtc datetime2 NOT NULL,
    IsDeleted bit NOT NULL,
    CONSTRAINT FK_DocumentAnnotations_Documents_DocumentId FOREIGN KEY (DocumentId) REFERENCES Documents(DocumentId),
    CONSTRAINT FK_DocumentAnnotations_DocumentVersions_DocumentVersionId FOREIGN KEY (DocumentVersionId) REFERENCES DocumentVersions(DocumentVersionId)
);
GO

CREATE TABLE DocumentJobs (
    DocumentJobId uniqueidentifier NOT NULL PRIMARY KEY,
    DocumentId uniqueidentifier NOT NULL,
    SourceDocumentVersionId uniqueidentifier NULL,
    OutputDocumentVersionId uniqueidentifier NULL,
    JobType int NOT NULL,
    JobStatus int NOT NULL,
    RequestedByUserId uniqueidentifier NOT NULL,
    CompressionProfile int NULL,
    StartedOnUtc datetime2 NULL,
    CompletedOnUtc datetime2 NULL,
    FailureReason nvarchar(2000) NULL,
    MetadataJson nvarchar(max) NOT NULL,
    CreatedOnUtc datetime2 NOT NULL,
    CONSTRAINT FK_DocumentJobs_Documents_DocumentId FOREIGN KEY (DocumentId) REFERENCES Documents(DocumentId),
    CONSTRAINT FK_DocumentJobs_DocumentVersions_SourceDocumentVersionId FOREIGN KEY (SourceDocumentVersionId) REFERENCES DocumentVersions(DocumentVersionId),
    CONSTRAINT FK_DocumentJobs_DocumentVersions_OutputDocumentVersionId FOREIGN KEY (OutputDocumentVersionId) REFERENCES DocumentVersions(DocumentVersionId),
    CONSTRAINT FK_DocumentJobs_Users_RequestedByUserId FOREIGN KEY (RequestedByUserId) REFERENCES Users(UserId)
);
GO

CREATE INDEX IX_DocumentJobs_DocumentId_JobStatus ON DocumentJobs (DocumentId, JobStatus);
GO

CREATE TABLE AuditLogs (
    AuditLogId uniqueidentifier NOT NULL PRIMARY KEY,
    UserId uniqueidentifier NULL,
    EventType nvarchar(128) NOT NULL,
    EntityName nvarchar(128) NOT NULL,
    EntityId nvarchar(128) NULL,
    EventDescription nvarchar(2000) NOT NULL,
    IpAddress nvarchar(128) NULL,
    UserAgent nvarchar(512) NULL,
    AdditionalDataJson nvarchar(max) NOT NULL,
    CreatedOnUtc datetime2 NOT NULL,
    CONSTRAINT FK_AuditLogs_Users_UserId FOREIGN KEY (UserId) REFERENCES Users(UserId)
);
GO

CREATE INDEX IX_AuditLogs_CreatedOnUtc ON AuditLogs (CreatedOnUtc);
GO
