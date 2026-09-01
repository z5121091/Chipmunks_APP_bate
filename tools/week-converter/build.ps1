$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Set-Location -LiteralPath $PSScriptRoot

function Find-Python {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        return $pythonCommand.Source
    }

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

    return $null
}

$python = Find-Python
if (-not $python) {
    throw 'Python 3.10 or newer was not found.'
}

Write-Host '[1/4] Running self-check...' -ForegroundColor Cyan
& $python (Join-Path $PSScriptRoot 'week_converter.py') --self-test
if ($LASTEXITCODE -ne 0) {
    throw 'Week converter self-check failed.'
}

Write-Host '[2/4] Checking PyInstaller...' -ForegroundColor Cyan
& $python -c 'import PyInstaller' 2>$null
if ($LASTEXITCODE -ne 0) {
    & $python -m pip install pyinstaller -q
    if ($LASTEXITCODE -ne 0) {
        throw 'PyInstaller installation failed.'
    }
}

$appName = -join @(
    [char]0x751F,
    [char]0x4EA7,
    [char]0x5468,
    [char]0x6B21,
    [char]0x8F6C,
    [char]0x6362,
    [char]0x5DE5,
    [char]0x5177
)
$iconPath = Join-Path $PSScriptRoot 'icon.ico'
if (-not (Test-Path -LiteralPath $iconPath)) {
    throw 'The standalone week converter icon is missing.'
}

Write-Host '[3/4] Building standalone EXE...' -ForegroundColor Cyan
$arguments = @(
    '--noconfirm',
    '--clean',
    '--onefile',
    '--windowed',
    '--log-level',
    'WARN',
    '--name',
    $appName,
    '--icon',
    $iconPath,
    '--add-data',
    "$iconPath;.",
    (Join-Path $PSScriptRoot 'week_converter.py')
)
& $python -m PyInstaller @arguments
if ($LASTEXITCODE -ne 0) {
    throw 'PyInstaller build failed.'
}

$buildDir = Join-Path $PSScriptRoot 'build'
$specFile = Join-Path $PSScriptRoot "$appName.spec"
if (Test-Path -LiteralPath $buildDir) {
    Remove-Item -LiteralPath $buildDir -Recurse -Force
}
if (Test-Path -LiteralPath $specFile) {
    Remove-Item -LiteralPath $specFile -Force
}

Write-Host '[4/4] Creating desktop shortcut...' -ForegroundColor Cyan
$exePath = Join-Path $PSScriptRoot "dist\$appName.exe"
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath "$appName.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.IconLocation = "$exePath,0"
$shortcut.Description = 'Convert a production week code to ISO calendar dates.'
$shortcut.Save()

Write-Host ''
Write-Host 'Build succeeded.' -ForegroundColor Green
Write-Host "EXE: $exePath"
Write-Host "Desktop shortcut: $shortcutPath"
