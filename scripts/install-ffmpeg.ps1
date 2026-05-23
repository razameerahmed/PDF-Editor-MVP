[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$SkipWingetInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common-tools.ps1")

function Get-WingetFfmpegPackagePayload {
    $packagesRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (-not (Test-Path $packagesRoot)) {
        throw "Winget packages directory was not found at '$packagesRoot'."
    }

    $packageDirectory = Get-ChildItem -Path $packagesRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "Gyan.FFmpeg.Essentials*" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $packageDirectory) {
        throw "The winget package payload for Gyan.FFmpeg.Essentials could not be located."
    }

    $payloadDirectory = Get-ChildItem -Path $packageDirectory.FullName -Directory -Filter "ffmpeg-*-essentials_build" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $payloadDirectory) {
        throw "The extracted ffmpeg payload could not be located under '$($packageDirectory.FullName)'."
    }

    return $payloadDirectory
}

function Get-FfmpegPayloadVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PayloadDirectoryName
    )

    $match = [regex]::Match($PayloadDirectoryName, '^ffmpeg-(?<version>\d+(?:\.\d+){0,3})-essentials_build$', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) {
        throw "Unable to determine the ffmpeg version from '$PayloadDirectoryName'."
    }

    return $match.Groups["version"].Value
}

$repoRoot = Get-WorkspaceRoot
$packageId = "Gyan.FFmpeg.Essentials"
$toolRoot = Get-ProjectToolRoot -RepoRoot $repoRoot -ToolName "ffmpeg"

if (-not $SkipWingetInstall) {
    Write-Host "Installing or upgrading $packageId through winget..."
    & winget install --id $packageId --exact --accept-package-agreements --accept-source-agreements --silent --scope user
}

$payloadDirectory = Get-WingetFfmpegPackagePayload
$version = Get-FfmpegPayloadVersion -PayloadDirectoryName $payloadDirectory.Name
$destinationRoot = Join-Path $toolRoot $version
$binPath = Join-Path $destinationRoot "bin"

if ((Test-Path $destinationRoot) -and -not $Force) {
    Write-Host "Project-local ffmpeg $version already exists at '$destinationRoot'."
} else {
    if (Test-Path $destinationRoot) {
        Remove-Item -LiteralPath $destinationRoot -Recurse -Force
    }

    New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $payloadDirectory.FullName "*") -Destination $destinationRoot -Recurse -Force
    Write-Host "Copied ffmpeg $version into '$destinationRoot'."
}

$ffmpegPath = Join-Path $binPath "ffmpeg.exe"
$ffprobePath = Join-Path $binPath "ffprobe.exe"
if (-not (Test-Path $ffmpegPath) -or -not (Test-Path $ffprobePath)) {
    throw "The project-local ffmpeg binaries were not found after copy. Expected '$ffmpegPath' and '$ffprobePath'."
}

$versionOutput = & $ffmpegPath -version | Select-Object -First 1
Write-Host $versionOutput
Write-Host "Project-local ffmpeg is ready:"
Write-Host "  ffmpeg : $ffmpegPath"
Write-Host "  ffprobe: $ffprobePath"
