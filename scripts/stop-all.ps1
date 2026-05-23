[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$IncludeLauncherShells,
    [string]$ExcludeProcessIds = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-TrackedProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string[]]$CommandLineMatches
    )

    $results = @()

    foreach ($process in Get-CimInstance Win32_Process -ErrorAction SilentlyContinue) {
        if (-not $process.CommandLine) {
            continue
        }

        foreach ($commandLineMatch in $CommandLineMatches) {
            if ($process.CommandLine -like "*$commandLineMatch*") {
                $results += [pscustomobject]@{
                    Name = $Name
                    ProcessId = [int]$process.ProcessId
                    Executable = $process.Name
                    CommandLine = $process.CommandLine
                }
                break
            }
        }
    }

    return $results
}

function Get-WorkspaceRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Get-ParentProcessId {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    try {
        return [int](Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").ParentProcessId
    }
    catch {
        return 0
    }
}

function Get-AncestorProcessIds {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId,

        [int]$MaxDepth = 6
    )

    $ids = @()
    $currentId = $ProcessId

    for ($depth = 0; $depth -lt $MaxDepth; $depth++) {
        if ($currentId -le 0 -or $ids -contains $currentId) {
            break
        }

        $ids += $currentId
        $currentId = Get-ParentProcessId -ProcessId $currentId
    }

    return $ids
}

function Get-PidFileProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PidRoot
    )

    $results = @()
    if (-not (Test-Path $PidRoot)) {
        return $results
    }

    foreach ($pidFile in Get-ChildItem -LiteralPath $PidRoot -Filter *.pid -File -ErrorAction SilentlyContinue) {
        $rawPid = (Get-Content -LiteralPath $pidFile.FullName -Raw -ErrorAction SilentlyContinue).Trim()
        if (-not ($rawPid -match '^\d+$')) {
            continue
        }

        $processId = [int]$rawPid
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if (-not $process) {
            continue
        }

        $results += [pscustomobject]@{
            Name = "Pid File [$($pidFile.BaseName)]"
            ProcessId = $processId
            Executable = $process.Name
            CommandLine = $process.CommandLine
        }
    }

    return $results
}

function Get-PortProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [int[]]$Ports
    )

    $processes = @()

    foreach ($port in $Ports) {
        foreach ($connection in Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            $processes += [pscustomobject]@{
                Name = $Name
                ProcessId = [int]$connection.OwningProcess
                Executable = ""
                CommandLine = "Listening on port $port"
            }
        }
    }

    return $processes
}

function Get-WorkspaceProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$WorkspaceRoot,

        [string[]]$ExecutableNames = @()
    )

    $results = @()

    foreach ($process in Get-CimInstance Win32_Process -ErrorAction SilentlyContinue) {
        if (-not $process.CommandLine) {
            continue
        }

        if ($ExecutableNames.Count -gt 0 -and $ExecutableNames -notcontains $process.Name) {
            continue
        }

        if ($process.CommandLine -like "*$WorkspaceRoot*") {
            $results += [pscustomobject]@{
                Name = $Name
                ProcessId = [int]$process.ProcessId
                Executable = $process.Name
                CommandLine = $process.CommandLine
            }
        }
    }

    return $results
}

$workspaceRoot = Get-WorkspaceRoot
$pidRoot = Join-Path $workspaceRoot "runtime\pids"
$excludedProcessIds = @()
if (-not [string]::IsNullOrWhiteSpace($ExcludeProcessIds)) {
    $excludedProcessIds = $ExcludeProcessIds.Split(",", [System.StringSplitOptions]::RemoveEmptyEntries) |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -match '^\d+$' } |
        ForEach-Object { [int]$_ }
}

$excludedProcessIds += Get-AncestorProcessIds -ProcessId $PID
$excludedProcessIds = $excludedProcessIds | Sort-Object -Unique

$targets = @()
$targets += @(Get-PidFileProcesses -PidRoot $pidRoot)
$targets += @(Get-TrackedProcess -Name "PdfEditor API" -CommandLineMatches @("PdfEditor.Api.csproj", "PdfEditor.Api.dll"))
$targets += @(Get-TrackedProcess -Name "PdfEditor Worker" -CommandLineMatches @("PdfEditor.Worker.csproj", "PdfEditor.Worker.dll"))
$targets += @(Get-TrackedProcess -Name "PdfEditor Document Engine" -CommandLineMatches @("PdfEditor.DocumentEngine\\main.py", "pdf_editor_document_engine.api.app"))
$targets += @(Get-TrackedProcess -Name "PdfEditor Web" -CommandLineMatches @("apps\\web\\pdf-editor-web", "vite"))
$targets += @(Get-WorkspaceProcess -Name "Workspace Process" -WorkspaceRoot $workspaceRoot -ExecutableNames @("dotnet.exe", "python.exe", "node.exe"))
$targets += @(Get-WorkspaceProcess -Name "Workspace Runner" -WorkspaceRoot $workspaceRoot -ExecutableNames @("cmd.exe"))
if ($IncludeLauncherShells) {
    $targets += @(Get-WorkspaceProcess -Name "Workspace PowerShell" -WorkspaceRoot $workspaceRoot -ExecutableNames @("powershell.exe"))
}
$targets += @(Get-PortProcess -Name "Hosted App Port" -Ports @(5144, 5173, 8787))

$targets = @($targets |
    Group-Object ProcessId |
    ForEach-Object { $_.Group[0] } |
    Where-Object { $_ -and $_.PSObject.Properties.Name -contains 'ProcessId' } |
    Sort-Object Name, ProcessId)

if (-not $targets) {
    Write-Host "No PdfEditor application processes were found."
    return
}

foreach ($target in $targets) {
    if (-not ($target.PSObject.Properties.Name -contains 'ProcessId')) {
        continue
    }

    if ($excludedProcessIds -contains $target.ProcessId) {
        Write-Host ("Skipped [{0}] PID {1}" -f $target.Name, $target.ProcessId)
        continue
    }

    if ($DryRun) {
        Write-Host ("[{0}] PID {1} {2}" -f $target.Name, $target.ProcessId, $target.CommandLine)
        continue
    }

    try {
        Stop-Process -Id $target.ProcessId -Force -ErrorAction Stop
        Write-Host ("Stopped [{0}] PID {1}" -f $target.Name, $target.ProcessId)
    }
    catch {
        Write-Warning ("Could not stop PID {0}: {1}" -f $target.ProcessId, $_.Exception.Message)
    }
}

if (-not $DryRun -and (Test-Path $pidRoot)) {
    Get-ChildItem -LiteralPath $pidRoot -Filter *.pid -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}
