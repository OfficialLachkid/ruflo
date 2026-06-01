param(
    [string]$VaultPath = "Jacobs-2",
    [string]$BridgeSubpath = "90_Ruflo_Bridge",
    [string]$ExportPath = "data/vault-bridge/current"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$vaultRoot = Join-Path $repoRoot $VaultPath
$bridgeRoot = Join-Path $vaultRoot $BridgeSubpath
$exportRoot = Join-Path $repoRoot $ExportPath
$manifestPath = Join-Path $exportRoot "manifest.json"

if (-not (Test-Path $vaultRoot)) {
    throw "Vault path not found: $vaultRoot"
}

if (-not (Test-Path $bridgeRoot)) {
    throw "Bridge path not found: $bridgeRoot"
}

New-Item -ItemType Directory -Force -Path $exportRoot | Out-Null

$bridgeFiles = Get-ChildItem -Path $bridgeRoot -File -Filter "*.md" | Sort-Object Name

foreach ($file in $bridgeFiles) {
    Copy-Item -Path $file.FullName -Destination (Join-Path $exportRoot $file.Name) -Force
}

$manifest = foreach ($file in $bridgeFiles) {
    $hash = Get-FileHash -Path $file.FullName -Algorithm SHA256
    [pscustomobject]@{
        name = $file.Name
        source = $file.FullName
        sha256 = $hash.Hash
        lastWriteTimeUtc = $file.LastWriteTimeUtc.ToString("o")
    }
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestPath

Write-Host "Synced $($bridgeFiles.Count) bridge notes to $exportRoot"
Write-Host "Manifest written to $manifestPath"
