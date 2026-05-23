[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$NpmPath,

    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,

    [Parameter(Mandatory = $true)]
    [string]$NodeDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location $WorkingDirectory
if ($env:Path -notlike "*$NodeDirectory*") {
    $env:Path = "$NodeDirectory;$env:Path"
}

& $NpmPath run dev
