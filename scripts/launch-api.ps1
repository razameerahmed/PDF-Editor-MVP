[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DotnetPath,

    [Parameter(Mandatory = $true)]
    [string]$ProjectPath,

    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location $WorkingDirectory
$env:ASPNETCORE_ENVIRONMENT = "Development"
& $DotnetPath run --project $ProjectPath
