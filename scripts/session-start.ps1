param(
    [string]$SessionId = ("session-" + (Get-Date -Format "yyyyMMdd-HHmmss")),
    [string]$CliPackage = "ruflo@latest",
    [string]$Query,
    [string]$Namespace = "patterns",
    [string]$PreTaskDescription,
    [switch]$SkipDaemon,
    [switch]$SkipVaultSync
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$syncScript = Join-Path $PSScriptRoot "sync-vault.ps1"

if (-not $SkipVaultSync) {
    & $syncScript
}

$sessionArgs = @($CliPackage, "hooks", "session-start", "--session-id", $SessionId)
if (-not $SkipDaemon) {
    $sessionArgs += "--start-daemon"
}

Write-Host "Starting Ruflo session: $SessionId"
& npx @sessionArgs
if ($LASTEXITCODE -ne 0) {
    throw "Ruflo session-start failed."
}

if ($Query) {
    Write-Host "Searching memory namespace '$Namespace' with query: $Query"
    & npx $CliPackage "memory" "search" "--query" $Query "--namespace" $Namespace
    if ($LASTEXITCODE -ne 0) {
        throw "Ruflo memory search failed."
    }
}

if ($PreTaskDescription) {
    Write-Host "Recording pre-task description."
    & npx $CliPackage "hooks" "pre-task" "--description" $PreTaskDescription
    if ($LASTEXITCODE -ne 0) {
        throw "Ruflo pre-task hook failed."
    }
}
