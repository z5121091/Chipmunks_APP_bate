param([string]$NotesFile, [string]$PackagePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
try {
    if ([string]::IsNullOrWhiteSpace($NotesFile) -eq [string]::IsNullOrWhiteSpace($PackagePath)) {
        throw 'Specify either NotesFile or PackagePath.'
    }
    [void][System.Reflection.Assembly]::LoadWithPartialName('System.Security')
    $credential = Join-Path $env:LOCALAPPDATA 'ChipmunksBuildTools\ota\publish-token.bin'
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($credential), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $env:WAREHOUSE_OTA_TOKEN = [Text.Encoding]::UTF8.GetString($bytes)
    $env:PYTHONIOENCODING = 'utf-8'
    if (-not [string]::IsNullOrWhiteSpace($PackagePath)) {
        python -u (Join-Path $PSScriptRoot 'publish-ota.py') --package-file $PackagePath
    } else {
        python -u (Join-Path $PSScriptRoot 'publish-ota.py') --notes-file $NotesFile
    }
    exit $LASTEXITCODE
} catch { Write-Host 'Publication failed: 发布环境或凭证不可用，请在设置中核对发布连接，并检查本机 Python 环境。'; exit 1 }
finally { Remove-Item Env:WAREHOUSE_OTA_TOKEN -ErrorAction SilentlyContinue }
