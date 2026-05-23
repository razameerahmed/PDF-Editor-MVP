using System.Text.RegularExpressions;
using System.Runtime.Versioning;
using Microsoft.Win32;
using PdfEditor.Application.Abstractions;

namespace PdfEditor.Infrastructure.Services;

public sealed class InstalledFontCatalogService : IInstalledFontCatalogService
{
    private static readonly string[] CommonWindowsFontFallbacks =
    [
        "Arial",
        "Bahnschrift",
        "Calibri",
        "Cambria",
        "Candara",
        "Consolas",
        "Corbel",
        "Courier New",
        "Georgia",
        "Segoe UI",
        "Tahoma",
        "Times New Roman",
        "Trebuchet MS",
        "Verdana"
    ];

    private static readonly string[] FontRegistryPaths =
    [
        @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        @"SOFTWARE\Microsoft\Windows\CurrentVersion\Fonts"
    ];

    private static readonly string[] KnownStyleSuffixes =
    [
        " Bold Italic",
        " Bold",
        " Italic",
        " Regular",
        " Light",
        " Semibold",
        " SemiBold",
        " Medium",
        " Black"
    ];

    private readonly Lazy<IReadOnlyCollection<string>> installedFontNames;

    public InstalledFontCatalogService()
    {
        installedFontNames = new Lazy<IReadOnlyCollection<string>>(LoadInstalledFontNames, LazyThreadSafetyMode.ExecutionAndPublication);
    }

    public Task<IReadOnlyCollection<string>> GetInstalledFontNamesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(installedFontNames.Value);
    }

    private static IReadOnlyCollection<string> LoadInstalledFontNames()
    {
        var fontNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (OperatingSystem.IsWindows())
        {
            AddRegistryFonts(fontNames, RegistryView.Registry64);
            AddRegistryFonts(fontNames, RegistryView.Registry32);
        }

        if (fontNames.Count == 0)
        {
            foreach (var fallbackFont in CommonWindowsFontFallbacks)
            {
                fontNames.Add(fallbackFont);
            }
        }

        return fontNames
            .OrderBy(fontName => fontName, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    [SupportedOSPlatform("windows")]
    private static void AddRegistryFonts(ISet<string> fontNames, RegistryView registryView)
    {
        try
        {
            using var localMachine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, registryView);
            using var currentUser = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, registryView);

            foreach (var registryPath in FontRegistryPaths)
            {
                AddRegistryFonts(fontNames, localMachine.OpenSubKey(registryPath));
                AddRegistryFonts(fontNames, currentUser.OpenSubKey(registryPath));
            }
        }
        catch
        {
        }
    }

    [SupportedOSPlatform("windows")]
    private static void AddRegistryFonts(ISet<string> fontNames, RegistryKey? registryKey)
    {
        if (registryKey is null)
        {
            return;
        }

        foreach (var valueName in registryKey.GetValueNames())
        {
            AddFontName(fontNames, valueName);
        }
    }

    private static void AddFontName(ISet<string> fontNames, string? rawFontName)
    {
        var normalizedFontName = NormalizeRegistryFontName(rawFontName);
        if (string.IsNullOrWhiteSpace(normalizedFontName))
        {
            return;
        }

        fontNames.Add(normalizedFontName);

        var familyFontName = NormalizeFontFamilyName(normalizedFontName);
        if (!string.IsNullOrWhiteSpace(familyFontName))
        {
            fontNames.Add(familyFontName);
        }
    }

    private static string NormalizeRegistryFontName(string? rawFontName)
    {
        if (string.IsNullOrWhiteSpace(rawFontName))
        {
            return string.Empty;
        }

        var normalizedFontName = Regex.Replace(
            rawFontName.Trim(),
            @"\s*\((truetype|opentype|raster)\)\s*$",
            string.Empty,
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        normalizedFontName = Regex.Replace(normalizedFontName, @"\s+", " ", RegexOptions.CultureInvariant).Trim();
        return normalizedFontName.StartsWith('@') ? string.Empty : normalizedFontName;
    }

    private static string NormalizeFontFamilyName(string rawFontName)
    {
        foreach (var styleSuffix in KnownStyleSuffixes)
        {
            if (rawFontName.EndsWith(styleSuffix, StringComparison.OrdinalIgnoreCase))
            {
                return rawFontName[..^styleSuffix.Length].Trim();
            }
        }

        return rawFontName;
    }
}
