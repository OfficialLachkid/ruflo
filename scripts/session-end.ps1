param(
    [string]$CliPackage = "ruflo@latest",
    [string]$TaskId,
    [bool]$Success = $true,
    [string]$Agent = "coder",
    [string]$PatternKey,
    [string]$PatternValue,
    [string]$PatternNamespace = "patterns",
    [switch]$SkipExportMetrics,
    [switch]$SkipPersistPatterns
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($PatternKey -and $PatternValue) {
    Write-Host "Storing pattern in namespace '$PatternNamespace': $PatternKey"
    & npx $CliPackage "memory" "store" "--key" $PatternKey "--value" $PatternValue "--namespace" $PatternNamespace
    if ($LASTEXITCODE -ne 0) {
        throw "Ruflo memory store failed."
    }
}

if ($TaskId) {
    $successText = if ($Success) { "true" } else { "false" }
    Write-Host "Recording post-task outcome for $TaskId"
    & npx $CliPackage "hooks" "post-task" "--task-id" $TaskId "--success" $successText "--agent" $Agent
    if ($LASTEXITCODE -ne 0) {
        throw "Ruflo post-task hook failed."
    }
}

$sessionArgs = @($CliPackage, "hooks", "session-end")
if (-not $SkipExportMetrics) {
    $sessionArgs += "--export-metrics"
}
if (-not $SkipPersistPatterns) {
    $sessionArgs += "--persist-patterns"
}

Write-Host "Ending Ruflo session"
& npx @sessionArgs
if ($LASTEXITCODE -ne 0) {
    throw "Ruflo session-end failed."
}
