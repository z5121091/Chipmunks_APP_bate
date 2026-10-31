param([ValidateSet('Apk','Sync','Both')][string]$Target = 'Both', [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'build-environment.ps1')
try {
    Ensure-BuildEnvironment -Target $Target -CheckOnly:$CheckOnly | Out-Null
    Write-Host 'No APK or EXE build was started.'
} catch {
    Write-Host ('ENVIRONMENT FAILED: ' + [regex]::Replace($_.Exception.Message, '(?i)(https?://)[^/\s@]+@', '$1***@')) -ForegroundColor Red
    exit 1
}
