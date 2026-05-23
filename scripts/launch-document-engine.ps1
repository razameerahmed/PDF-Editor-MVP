[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PythonPath,

    [Parameter(Mandatory = $true)]
    [string]$EntryPointPath,

    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location $WorkingDirectory
& $PythonPath $EntryPointPath
