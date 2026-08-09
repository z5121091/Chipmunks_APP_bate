$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Set-Location -LiteralPath $PSScriptRoot

function Write-Step {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Find-Python {
    $candidatePaths = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python310\python.exe')
    )

    foreach ($path in $candidatePaths) {
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        return $pythonCommand.Source
    }

    return $null
}

Write-Host '===================================='
Write-Host '  Palm Warehouse ERP Sync - Build Tool'
Write-Host '===================================='
Write-Host ''

$python = Find-Python
if (-not $python) {
    Write-Host '[ERROR] Python was not found. Please install Python 3.8+.' -ForegroundColor Red
    Write-Host 'Download: https://www.python.org/downloads/'
    exit 1
}

Write-Step "[Python] $python"
& $python --version
if ($LASTEXITCODE -ne 0) {
    throw 'Python is not runnable.'
}

Write-Step '[1/4] Installing dependencies...'
& $python -m pip install cherrypy openpyxl pystray Pillow pywin32 pyinstaller -q
if ($LASTEXITCODE -ne 0) {
    throw 'Dependency installation failed.'
}

Write-Step '[2/4] Checking icon...'
$iconPath = Join-Path $PSScriptRoot 'icon.ico'
$logoPath = Join-Path $PSScriptRoot 'assets\geehy-logo.png'
$pbIconPath = Join-Path $PSScriptRoot 'assets\pb-logo.png'
$appName = '掌上仓库ERP版同步助手'
$pyInstallerArgs = @(
    '--noconfirm',
    '--onefile',
    '--windowed',
    '--log-level',
    'WARN',
    '--hidden-import',
    'win32print',
    '--hidden-import',
    'pywintypes',
    '--name',
    $appName
)

if (Test-Path -LiteralPath $iconPath) {
    Write-Host '[OK] Found icon.ico'
    $pyInstallerArgs += @('--icon', $iconPath)
    $pyInstallerArgs += @('--add-data', "$iconPath;.")
} else {
    Write-Host '[INFO] icon.ico was not found. The default icon will be used.'
}

if (-not (Test-Path -LiteralPath $logoPath)) {
    throw 'Geehy logo asset was not found: scripts\assets\geehy-logo.png'
}
Write-Host '[OK] Found Geehy logo asset'
$pyInstallerArgs += @('--add-data', "$logoPath;assets")

if (-not (Test-Path -LiteralPath $pbIconPath)) {
    throw 'Pb icon asset was not found: scripts\assets\pb-logo.png'
}
Write-Host '[OK] Found Pb icon asset'
$pyInstallerArgs += @('--add-data', "$pbIconPath;assets")

$pyInstallerArgs += (Join-Path $PSScriptRoot 'label_sync_server.py')

Write-Step '[3/4] Building executable...'
$distDir = Join-Path $PSScriptRoot 'dist'
if (Test-Path -LiteralPath $distDir) {
    $outputExe = Join-Path $distDir "$appName.exe"
    if (Test-Path -LiteralPath $outputExe) {
        Remove-Item -LiteralPath $outputExe -Force
    }
}

& $python -m PyInstaller @pyInstallerArgs
if ($LASTEXITCODE -ne 0) {
    throw 'PyInstaller build failed.'
}

Write-Step '[4/4] Cleaning temporary files...'
$buildDir = Join-Path $PSScriptRoot 'build'
$specFile = Join-Path $PSScriptRoot "$appName.spec"

if (Test-Path -LiteralPath $buildDir) {
    Remove-Item -LiteralPath $buildDir -Recurse -Force
}

if (Test-Path -LiteralPath $specFile) {
    Remove-Item -LiteralPath $specFile -Force
}

Write-Host ''
Write-Host '===================================='
Write-Host '  Build succeeded.'
Write-Host '  Output: scripts\dist'
Write-Host '===================================='
Write-Host ''
Write-Host 'Usage:'
Write-Host '1. Open the EXE file in scripts\dist.'
Write-Host '2. Find the tray icon after launch.'
Write-Host '3. Right-click the tray icon to configure startup.'
