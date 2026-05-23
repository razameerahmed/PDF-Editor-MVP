[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [string]$OutputDirectory = "",

    [string[]]$CaptureTimestamps = @("00:00:01", "00:00:03", "00:00:05"),

    [switch]$OpenOutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common-tools.ps1")

function Convert-TimestampToSafeFilePart {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Timestamp
    )

    return ($Timestamp -replace '[^0-9A-Za-z]+', '-').Trim('-')
}

$repoRoot = Get-WorkspaceRoot
$resolvedInputPath = (Resolve-Path -LiteralPath $InputPath).Path
$toolPaths = Get-FfmpegToolPaths -RepoRoot $repoRoot -Require

if (-not $OutputDirectory) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($resolvedInputPath)
    $timestampSuffix = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputDirectory = Join-Path $repoRoot ("runtime\archive\debug-frames\{0}-{1}" -f $baseName, $timestampSuffix)
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$metadataPath = Join-Path $OutputDirectory "metadata.json"
$metadataJson = & $toolPaths.FfprobePath -v quiet -print_format json -show_format -show_streams -- $resolvedInputPath
$metadataJson | Set-Content -LiteralPath $metadataPath -Encoding UTF8

$frameOutputPaths = @()
for ($index = 0; $index -lt $CaptureTimestamps.Count; $index++) {
    $timestamp = $CaptureTimestamps[$index]
    $safeTimestamp = Convert-TimestampToSafeFilePart -Timestamp $timestamp
    $frameOutputPath = Join-Path $OutputDirectory ("frame-{0:D2}-{1}.png" -f ($index + 1), $safeTimestamp)

    & $toolPaths.FfmpegPath -hide_banner -loglevel error -y -ss $timestamp -i $resolvedInputPath -frames:v 1 -update 1 $frameOutputPath | Out-Null
    $frameOutputPaths += $frameOutputPath
}

Write-Host "Resolved tools:"
Write-Host "  ffmpeg : $($toolPaths.FfmpegPath)"
Write-Host "  ffprobe: $($toolPaths.FfprobePath)"
Write-Host "Input:"
Write-Host "  $resolvedInputPath"
Write-Host "Metadata:"
Write-Host "  $metadataPath"
Write-Host "Frames:"
$frameOutputPaths | ForEach-Object { Write-Host "  $_" }

if ($OpenOutputDirectory) {
    Start-Process explorer.exe $OutputDirectory | Out-Null
}
