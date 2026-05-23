function Get-WorkspaceRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Get-ProjectToolRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,

        [Parameter(Mandatory = $true)]
        [string]$ToolName
    )

    return Join-Path $RepoRoot ("runtime\tools\{0}" -f $ToolName)
}

function Get-VersionSortKey {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $normalized = [regex]::Match($Value, '\d+(?:\.\d+){0,3}').Value
    if (-not $normalized) {
        return [version]"0.0.0.0"
    }

    $segments = $normalized.Split(".")
    while ($segments.Count -lt 4) {
        $segments += "0"
    }

    return [version]($segments -join ".")
}

function Get-InstalledProjectToolDirectories {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,

        [Parameter(Mandatory = $true)]
        [string]$ToolName
    )

    $toolRoot = Get-ProjectToolRoot -RepoRoot $RepoRoot -ToolName $ToolName
    if (-not (Test-Path $toolRoot)) {
        return @()
    }

    return @(Get-ChildItem -Path $toolRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object @{ Expression = { Get-VersionSortKey -Value $_.Name }; Descending = $true }, Name -Descending)
}

function Resolve-ProjectToolBinaryPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,

        [Parameter(Mandatory = $true)]
        [string]$ToolName,

        [Parameter(Mandatory = $true)]
        [string]$ExecutableName
    )

    foreach ($directory in Get-InstalledProjectToolDirectories -RepoRoot $RepoRoot -ToolName $ToolName) {
        $candidate = Join-Path $directory.FullName ("bin\{0}" -f $ExecutableName)
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Resolve-RepoCommandPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,

        [Parameter(Mandatory = $true)]
        [string]$CommandName,

        [string]$ToolName = "",

        [string[]]$FallbackPaths = @()
    )

    if ($ToolName) {
        $localPath = Resolve-ProjectToolBinaryPath -RepoRoot $RepoRoot -ToolName $ToolName -ExecutableName $CommandName
        if ($localPath) {
            return $localPath
        }
    }

    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    foreach ($fallbackPath in $FallbackPaths) {
        if (Test-Path $fallbackPath) {
            return $fallbackPath
        }
    }

    throw "Required executable '$CommandName' was not found."
}

function Get-FfmpegToolPaths {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,

        [switch]$Require
    )

    $ffmpegPath = Resolve-ProjectToolBinaryPath -RepoRoot $RepoRoot -ToolName "ffmpeg" -ExecutableName "ffmpeg.exe"
    $ffprobePath = Resolve-ProjectToolBinaryPath -RepoRoot $RepoRoot -ToolName "ffmpeg" -ExecutableName "ffprobe.exe"

    if (-not $ffmpegPath) {
        $command = Get-Command "ffmpeg.exe" -ErrorAction SilentlyContinue
        if ($command) {
            $ffmpegPath = $command.Source
        }
    }

    if (-not $ffprobePath) {
        $command = Get-Command "ffprobe.exe" -ErrorAction SilentlyContinue
        if ($command) {
            $ffprobePath = $command.Source
        }
    }

    if ($Require -and (-not $ffmpegPath -or -not $ffprobePath)) {
        throw "ffmpeg tooling is not installed for this workspace. Run '.\\scripts\\install-ffmpeg.ps1' first."
    }

    return [pscustomobject]@{
        FfmpegPath = $ffmpegPath
        FfprobePath = $ffprobePath
    }
}

