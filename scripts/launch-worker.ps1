[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DotnetPath,

    [Parameter(Mandatory = $true)]
    [string]$ProjectPath,

    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,

    [Parameter(Mandatory = $true)]
    [string]$ConnectionString
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location $WorkingDirectory
$env:ASPNETCORE_ENVIRONMENT = "Development"
$env:ConnectionStrings__SqlServer = $ConnectionString
& $DotnetPath run --project $ProjectPath
