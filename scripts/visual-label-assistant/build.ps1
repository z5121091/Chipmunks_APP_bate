$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -LiteralPath $PSScriptRoot

$pythonCommand = Get-Command python -ErrorAction Stop
$python = $pythonCommand.Source

Write-Host '[1/2] Installing dependencies...' -ForegroundColor Cyan
& $python -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt') -q
if ($LASTEXITCODE -ne 0) {
    throw 'Dependency installation failed.'
}

# Keep this file ASCII so Windows PowerShell 5.1 can parse it reliably.
$appName = -join ([char[]]@(
    0x638C,
    0x4E0A,
    0x4ED3,
    0x5E93,
    0x53EF,
    0x89C6,
    0x5316,
    0x540C,
    0x6B65,
    0x52A9,
    0x624B
))
$buildSuffix = [Environment]::GetEnvironmentVariable('PALM_WAREHOUSE_BUILD_SUFFIX')
if (-not [string]::IsNullOrWhiteSpace($buildSuffix)) {
    $appName += $buildSuffix
} else {
    $defaultOutput = Join-Path (Join-Path $PSScriptRoot 'dist') ($appName + '.exe')
    if (Test-Path -LiteralPath $defaultOutput) {
        try {
            $lockTest = [System.IO.File]::Open(
                $defaultOutput,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::ReadWrite,
                [System.IO.FileShare]::None
            )
            $lockTest.Dispose()
        } catch {
            $appName += '-' + (-join ([char[]]@(0x66F4, 0x65B0, 0x7248)))
            Write-Host 'The current EXE is running. Building an update copy instead.' -ForegroundColor Yellow
        }
    }
}

$pyInstallerArgs = @(
    '--noconfirm'
    '--onefile'
    '--windowed'
    '--log-level'
    'WARN'
    '--name'
    $appName
    '--hidden-import'
    'win32print'
    '--hidden-import'
    'pywintypes'
    '--hidden-import'
    'barcode.codex'
    '--hidden-import'
    'qrcode'
    '--hidden-import'
    'PySide6.QtCore'
    '--hidden-import'
    'PySide6.QtGui'
    '--hidden-import'
    'PySide6.QtWidgets'
    '--collect-all'
    'qtawesome'
    '--add-data'
    "$(Join-Path $PSScriptRoot 'assets');assets"
    '--add-data'
    "$(Join-Path $PSScriptRoot 'templates');templates"
    '--add-data'
    "$(Join-Path $PSScriptRoot 'icon.ico');."
    '--icon'
    (Join-Path $PSScriptRoot 'icon.ico')
    (Join-Path $PSScriptRoot 'app.py')
)

Write-Host '[2/2] Building standalone EXE...' -ForegroundColor Cyan
& $python -m PyInstaller @pyInstallerArgs
if ($LASTEXITCODE -ne 0) {
    throw 'PyInstaller build failed.'
}

$outputPath = Join-Path (Join-Path $PSScriptRoot 'dist') ($appName + '.exe')
Write-Host ('Build succeeded: ' + $outputPath) -ForegroundColor Green
