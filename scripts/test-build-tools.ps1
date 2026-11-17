# Isolated .NET Framework C# 5 regression suite; never builds APKs or publishes updates.
param([string[]]$Suites = @('RunnerTests','WindowTests','OtaConnectionTests','SupportTests','WebPreviewTests'), [string]$WindowCase)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$source = Join-Path $PSScriptRoot 'apk-builder'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$output = Join-Path $repo ('output/build-tools-tests-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $output -Force | Out-Null
$sources = @('Program.cs','BrandedForm.cs','BuildWindow.cs','BuildRunner.cs','BuildSupport.cs','BuildToolsWindow.cs','WebPreviewRunner.cs','SigningStore.cs','SigningWindow.cs','OtaConnectionPanel.cs','OtaConnection.cs') | ForEach-Object { Join-Path $source $_ }
$iconResource = '/resource:' + (Join-Path $PSScriptRoot 'icon.ico') + ',Chipmunks.ApkBuilder.AppIcon.ico'
$references = @('/reference:System.dll','/reference:System.Core.dll','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Security.dll','/reference:System.Web.Extensions.dll')
foreach ($suite in $Suites) {
    $exe = Join-Path $output ($suite + '.exe')
    $entry = if ($suite -eq 'SupportTests') { 'Chipmunks.ApkBuilder.SupportTests' } else { $suite }
    & $compiler /nologo /target:exe /platform:anycpu /utf8output /codepage:65001 /langversion:5 ('/out:' + $exe) ('/main:' + $entry) $iconResource @references @sources (Join-Path $source ('tests/' + $suite + '.cs'))
    if ($LASTEXITCODE -ne 0) { throw "$suite failed to compile." }
    if ($suite -eq 'WindowTests' -and $WindowCase) { & $exe (Join-Path $output $suite) $WindowCase }
    elseif ($suite -eq 'OtaConnectionTests') { & $exe }
    else { & $exe (Join-Path $output $suite) }
    if ($LASTEXITCODE -ne 0) { throw "$suite failed. Results retained at $output" }
}
Write-Host "Build tool regression results: $output"
