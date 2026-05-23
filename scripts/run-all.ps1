[CmdletBinding()]
param(
    [switch]$SkipApi,
    [switch]$SkipDocumentEngine,
    [switch]$SkipWorker,
    [switch]$SkipFrontend,
    [switch]$NoRestore,
    [switch]$DryRun,
    [switch]$NoCleanup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common-tools.ps1")

function Get-PowerShellPath {
    $candidatePaths = @(
        (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"),
        "powershell.exe"
    )

    foreach ($candidatePath in $candidatePaths) {
        if (Test-Path $candidatePath -ErrorAction SilentlyContinue) {
            return $candidatePath
        }
    }

    throw "Windows PowerShell could not be found."
}

function Get-ApiConnectionString {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ApiSettingsPath
    )

    $settings = Get-Content -LiteralPath $ApiSettingsPath -Raw | ConvertFrom-Json
    if (-not $settings.ConnectionStrings -or -not $settings.ConnectionStrings.SqlServer) {
        throw "ConnectionStrings:SqlServer is missing from '$ApiSettingsPath'."
    }

    return [string]$settings.ConnectionStrings.SqlServer
}

function Escape-ForSingleQuotedPowerShell {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    return $Value.Replace("'", "''")
}

function Start-LauncherProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,

        [Parameter(Mandatory = $true)]
        [string]$LauncherScriptPath,

        [Parameter(Mandatory = $true)]
        [hashtable]$Parameters,

        [Parameter(Mandatory = $true)]
        [string]$LogPrefix
    )

    if ($DryRun) {
        $formattedParameters = ($Parameters.GetEnumerator() |
            Sort-Object Key |
            ForEach-Object { ('-{0} "{1}"' -f $_.Key, $_.Value) }) -join " "
        Write-Host "[$Title]"
        Write-Host "$LauncherScriptPath $formattedParameters"
        Write-Host ""
        return $null
    }

    $powerShellPath = Get-PowerShellPath
    $logsRoot = Join-Path $repoRoot "runtime\logs"
    if (-not (Test-Path $logsRoot)) {
        New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
    }

    $stdoutPath = Join-Path $logsRoot "$LogPrefix-stdout.log"
    $stderrPath = Join-Path $logsRoot "$LogPrefix-stderr.log"
    Remove-Item $stdoutPath, $stderrPath -ErrorAction SilentlyContinue

    $argumentParts = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", ('"{0}"' -f $LauncherScriptPath)
    )

    foreach ($entry in $Parameters.GetEnumerator() | Sort-Object Key) {
        $argumentParts += "-$($entry.Key)"
        $argumentParts += ('"{0}"' -f ([string]$entry.Value).Replace('"', '\"'))
    }

    $argumentList = $argumentParts -join " "

    $process = Start-Process -FilePath $powerShellPath `
        -ArgumentList $argumentList `
        -WorkingDirectory $repoRoot `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    return $process
}

function Wait-ForHttpEndpoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Url,

        [int]$TimeoutSeconds = 45
    )

    if ($DryRun) {
        Write-Host "Would wait for [$Name] at $Url"
        return
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 800
        try {
            Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 | Out-Null
            Write-Host "$Name is ready at $Url"
            return
        }
        catch {
        }
    } while ((Get-Date) -lt $deadline)

    throw "$Name did not become ready at $Url within $TimeoutSeconds seconds."
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

$repoRoot = Get-WorkspaceRoot
$dotnetRoot = Join-Path $repoRoot "apps\dotnet"
$documentEngineRoot = Join-Path $repoRoot "apps\python\PdfEditor.DocumentEngine"
$documentEngineEntryPointPath = Join-Path $documentEngineRoot "main.py"
$solutionPath = Join-Path $dotnetRoot "PdfEditor.sln"
$apiProjectPath = Join-Path $dotnetRoot "src\PdfEditor.Api\PdfEditor.Api.csproj"
$workerProjectPath = Join-Path $dotnetRoot "src\PdfEditor.Worker\PdfEditor.Worker.csproj"
$apiSettingsPath = Join-Path $dotnetRoot "src\PdfEditor.Api\appsettings.Development.json"
$frontendPath = Join-Path $repoRoot "apps\web\pdf-editor-web"
$frontendNodeModulesPath = Join-Path $frontendPath "node_modules"
$launchDocumentEngineScriptPath = Join-Path $repoRoot "scripts\launch-document-engine.ps1"
$launchApiScriptPath = Join-Path $repoRoot "scripts\launch-api.ps1"
$launchWorkerScriptPath = Join-Path $repoRoot "scripts\launch-worker.ps1"
$launchFrontendScriptPath = Join-Path $repoRoot "scripts\launch-frontend.ps1"
$pidRoot = Join-Path $repoRoot "runtime\pids"
$venvPythonPath = Join-Path $repoRoot "runtime\python\venv\Scripts\python.exe"

$dotnetPath = Resolve-RepoCommandPath -RepoRoot $repoRoot -CommandName "dotnet"
if (Test-Path $venvPythonPath) {
    $pythonPath = $venvPythonPath
}
else {
    $pythonPath = Resolve-RepoCommandPath -RepoRoot $repoRoot -CommandName "python.exe"
}
$nodePath = Resolve-RepoCommandPath -RepoRoot $repoRoot -CommandName "node.exe" -FallbackPaths @("C:\Program Files\nodejs\node.exe")
$npmPath = Resolve-RepoCommandPath -RepoRoot $repoRoot -CommandName "npm.cmd" -FallbackPaths @("C:\Program Files\nodejs\npm.cmd")
$nodeDirectory = Split-Path -Parent $nodePath
$stopScriptPath = Join-Path $repoRoot "scripts\stop-all.ps1"

if (-not (Test-Path $solutionPath)) {
    throw "Could not find the solution file at '$solutionPath'."
}

if (-not $NoCleanup) {
    if ($DryRun) {
        Write-Host "Would stop existing PdfEditor processes first."
    }
    else {
        Write-Host "Stopping any existing PdfEditor processes first..."
        $excludeProcessIdsValue = ((Get-AncestorProcessIds -ProcessId $PID) | Sort-Object -Unique) -join ","

        & $stopScriptPath -IncludeLauncherShells -ExcludeProcessIds $excludeProcessIdsValue
        Start-Sleep -Seconds 2
    }
}

if (-not (Test-Path $pidRoot)) {
    New-Item -ItemType Directory -Path $pidRoot -Force | Out-Null
}
else {
    Get-ChildItem -LiteralPath $pidRoot -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}

function Save-ServicePid {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ServiceName,

        [Parameter(Mandatory = $false)]
        [System.Diagnostics.Process]$Process
    )

    if (-not $Process) {
        return
    }

    $pidPath = Join-Path $pidRoot "$ServiceName.pid"
    Set-Content -LiteralPath $pidPath -Value $Process.Id -NoNewline
}

if (-not $NoRestore -and -not $DryRun) {
    Write-Host "Restoring .NET solution..."
    & $dotnetPath restore $solutionPath
}

if ($env:Path -notlike "*$nodeDirectory*") {
    $env:Path = "$nodeDirectory;$env:Path"
}

if (-not $SkipFrontend -and -not (Test-Path $frontendNodeModulesPath) -and -not $DryRun) {
    Write-Host "Installing frontend dependencies..."
    Push-Location $frontendPath
    try {
        & $npmPath install
    }
    finally {
        Pop-Location
    }
}

$connectionString = Get-ApiConnectionString -ApiSettingsPath $apiSettingsPath
$escapedRepoRoot = Escape-ForSingleQuotedPowerShell -Value $repoRoot
$escapedDotnetRoot = Escape-ForSingleQuotedPowerShell -Value $dotnetRoot
$escapedApiProjectPath = Escape-ForSingleQuotedPowerShell -Value $apiProjectPath
$escapedWorkerProjectPath = Escape-ForSingleQuotedPowerShell -Value $workerProjectPath
$escapedFrontendPath = Escape-ForSingleQuotedPowerShell -Value $frontendPath
$escapedDocumentEngineEntryPointPath = Escape-ForSingleQuotedPowerShell -Value $documentEngineEntryPointPath
$escapedDotnetPath = Escape-ForSingleQuotedPowerShell -Value $dotnetPath
$escapedPythonPath = Escape-ForSingleQuotedPowerShell -Value $pythonPath
$escapedNodeDirectory = Escape-ForSingleQuotedPowerShell -Value $nodeDirectory
$escapedNpmPath = Escape-ForSingleQuotedPowerShell -Value $npmPath
$escapedConnectionString = Escape-ForSingleQuotedPowerShell -Value $connectionString

if (-not $SkipDocumentEngine) {
    $documentEngineProcess = Start-LauncherProcess -Title "PdfEditor Document Engine" -LauncherScriptPath $launchDocumentEngineScriptPath -Parameters @{
        PythonPath = $pythonPath
        EntryPointPath = $documentEngineEntryPointPath
        WorkingDirectory = $repoRoot
    } -LogPrefix "document-engine"
    Save-ServicePid -ServiceName "document-engine" -Process $documentEngineProcess
    Wait-ForHttpEndpoint -Name "Document engine" -Url "http://127.0.0.1:8787/health"
}

if (-not $SkipApi) {
    $apiProcess = Start-LauncherProcess -Title "PdfEditor API" -LauncherScriptPath $launchApiScriptPath -Parameters @{
        DotnetPath = $dotnetPath
        ProjectPath = $apiProjectPath
        WorkingDirectory = $dotnetRoot
    } -LogPrefix "api"
    Save-ServicePid -ServiceName "api" -Process $apiProcess
    Wait-ForHttpEndpoint -Name "Hosted app" -Url "http://localhost:5144/"
}

if (-not $SkipWorker) {
    $workerProcess = Start-LauncherProcess -Title "PdfEditor Worker" -LauncherScriptPath $launchWorkerScriptPath -Parameters @{
        DotnetPath = $dotnetPath
        ProjectPath = $workerProjectPath
        WorkingDirectory = $dotnetRoot
        ConnectionString = $connectionString
    } -LogPrefix "worker"
    Save-ServicePid -ServiceName "worker" -Process $workerProcess
}

if (-not $SkipFrontend) {
    $frontendProcess = Start-LauncherProcess -Title "PdfEditor Web" -LauncherScriptPath $launchFrontendScriptPath -Parameters @{
        NpmPath = $npmPath
        WorkingDirectory = $frontendPath
        NodeDirectory = $nodeDirectory
    } -LogPrefix "frontend"
    Save-ServicePid -ServiceName "frontend" -Process $frontendProcess
    Wait-ForHttpEndpoint -Name "React dev app" -Url "http://localhost:5173/"
}

Write-Host ""
Write-Host "Launch complete."
Write-Host "Document engine: http://127.0.0.1:8787/"
Write-Host "Hosted app: http://localhost:5144/"
Write-Host "React dev app: http://localhost:5173/"
Write-Host ""
Write-Host "Use -SkipDocumentEngine, -SkipFrontend, -SkipWorker, or -SkipApi to start only the parts you want."
Write-Host "Use -DryRun to print the commands without launching new windows."
