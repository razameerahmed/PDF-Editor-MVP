using System.IO;
using System.Runtime.CompilerServices;
using System.Threading;
using NLog;
using NLog.Config;
using NLog.Targets;

namespace PdfEditor.Application.Common.Logging;

public static class AppLogger
{
    private static int isConfigured;

    public static void Configure(string? configurationPath = null)
    {
        if (Interlocked.Exchange(ref isConfigured, 1) == 1)
        {
            return;
        }

        if (!string.IsNullOrWhiteSpace(configurationPath) && File.Exists(configurationPath))
        {
            LogManager.Setup().LoadConfigurationFromFile(configurationPath);
            return;
        }

        var configuration = new LoggingConfiguration();
        var consoleTarget = new ColoredConsoleTarget("console")
        {
            Layout = "${longdate}|${level:uppercase=true}|${logger}|${message}|action=${event-properties:item=ACTION}|result=${event-properties:item=RESULT}|updatedBy=${event-properties:item=UPDATED_BY}|description=${event-properties:item=DESCRIPTION}|exception=${exception:format=tostring}"
        };

        configuration.AddRuleForAllLevels(consoleTarget);
        LogManager.Configuration = configuration;
    }

    public static void Info(
        string message,
        string action = "",
        string result = "",
        string updatedBy = "",
        string description = "",
        Exception? exception = null,
        [CallerMemberName] string methodName = "",
        [CallerFilePath] string filePath = "")
        => WriteLog(LogLevel.Info, message, action, result, updatedBy, description, exception, methodName, filePath);

    public static void Warn(
        string message,
        string action = "",
        string result = "",
        string updatedBy = "",
        string description = "",
        Exception? exception = null,
        [CallerMemberName] string methodName = "",
        [CallerFilePath] string filePath = "")
        => WriteLog(LogLevel.Warn, message, action, result, updatedBy, description, exception, methodName, filePath);

    public static void Error(
        string message,
        string action = "",
        string result = "",
        string updatedBy = "",
        string description = "",
        Exception? exception = null,
        [CallerMemberName] string methodName = "",
        [CallerFilePath] string filePath = "")
        => WriteLog(LogLevel.Error, message, action, result, updatedBy, description, exception, methodName, filePath);

    public static void Debug(
        string message,
        string action = "",
        string result = "",
        string updatedBy = "",
        string description = "",
        Exception? exception = null,
        [CallerMemberName] string methodName = "",
        [CallerFilePath] string filePath = "")
        => WriteLog(LogLevel.Debug, message, action, result, updatedBy, description, exception, methodName, filePath);

    private static void WriteLog(
        LogLevel level,
        string message,
        string action,
        string result,
        string updatedBy,
        string description,
        Exception? exception,
        string methodName,
        string filePath)
    {
        if (LogManager.Configuration is null)
        {
            Configure();
        }

        var className = Path.GetFileNameWithoutExtension(filePath);
        var logger = LogManager.GetLogger($"APP.{className}");
        var logEvent = new LogEventInfo(level, logger.Name, message)
        {
            Exception = exception
        };

        logEvent.Properties["CLASS"] = className;
        logEvent.Properties["METHOD"] = methodName;
        logEvent.Properties["UPDATED_BY"] = updatedBy ?? string.Empty;
        logEvent.Properties["ACTION"] = action ?? string.Empty;
        logEvent.Properties["RESULT"] = result ?? string.Empty;
        logEvent.Properties["MESSAGE"] = message ?? string.Empty;
        logEvent.Properties["DESCRIPTION"] = description ?? string.Empty;
        logEvent.Properties["EXCEPTION"] = exception?.ToString() ?? string.Empty;

        logger.Log(logEvent);
    }
}
