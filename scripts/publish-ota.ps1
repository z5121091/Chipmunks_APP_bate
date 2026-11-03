param([Parameter(Mandatory=$true)][string]$NotesFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
try {
    [void][System.Reflection.Assembly]::LoadWithPartialName('System.Security')
    $credential = Join-Path $env:LOCALAPPDATA 'ChipmunksBuildTools\ota\publish-token.bin'
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($credential), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $env:WAREHOUSE_OTA_TOKEN = [Text.Encoding]::UTF8.GetString($bytes)
    $env:PYTHONIOENCODING = 'utf-8'
    python -u (Join-Path $PSScriptRoot 'publish-ota.py') --notes-file $NotesFile
    exit $LASTEXITCODE
} catch { Write-Host 'Cannot publish. Check the local publishing environment and credentials.'; exit 1 }
finally { Remove-Item Env:WAREHOUSE_OTA_TOKEN -ErrorAction SilentlyContinue }
