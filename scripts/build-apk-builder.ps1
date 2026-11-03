param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$sourceDirectory = Join-Path $PSScriptRoot 'apk-builder'
$destination = Join-Path $repository '掌上仓库构建工具.exe'
$temporary = Join-Path $repository ('掌上仓库构建工具.' + [Guid]::NewGuid().ToString('N') + '.tmp.exe')
$backup = Join-Path $repository ('掌上仓库构建工具.' + [Guid]::NewGuid().ToString('N') + '.previous.exe')
$published = $false

try {
    $compiler = $null
    foreach ($framework in @('Framework64', 'Framework')) {
        $candidate = Join-Path $env:WINDIR ('Microsoft.NET/' + $framework + '/v4.0.30319/csc.exe')
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $compiler = $candidate; break }
    }
    if (-not $compiler) {
        throw '找不到系统 .NET Framework C# 编译器。请在 Windows 10/11 启用 .NET Framework 4.x。'
    }
    $sources = @('Program.cs', 'BuildWindow.cs', 'BuildRunner.cs', 'SigningStore.cs', 'SigningWindow.cs', 'OtaConnectionPanel.cs', 'OtaConnection.cs') | ForEach-Object {
        $source = Join-Path $sourceDirectory $_
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "缺少构建工具源码：$_" }
        $source
    }
    $manifest = Join-Path $sourceDirectory 'app.manifest'
    $icon = Join-Path $PSScriptRoot 'icon.ico'
    foreach ($required in @($manifest, $icon)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "缺少构建工具资源：$required" }
    }
    $arguments = @('/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/utf8output',
        '/codepage:65001', '/langversion:5', ('/out:' + $temporary), ('/win32manifest:' + $manifest),
        ('/win32icon:' + $icon), '/reference:System.dll', '/reference:System.Core.dll',
        '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Security.dll',
        '/reference:System.Web.Extensions.dll')
    & $compiler @arguments @sources
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporary -PathType Leaf)) {
        throw '构建窗口编译失败，原来的 掌上仓库构建工具.exe 已保留。'
    }

    try {
        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            # File.Replace commits the complete new executable in one operation; no half-built EXE is exposed.
            [IO.File]::Replace($temporary, $destination, $backup)
        } else {
            [IO.File]::Move($temporary, $destination)
        }
        $published = $true
    } catch {
        throw '无法更新 掌上仓库构建工具.exe。请退出构建工具（包括系统托盘中的窗口），确认没有任务运行后重试；已有 EXE 已保留。'
    }
    Write-Host "构建工具已生成：$destination" -ForegroundColor Green
    Write-Host '只编译了构建窗口，没有构建 APK、修改应用版本或重建同步助手。'
} catch {
    Write-Host ('构建工具生成失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    $cleanupFiles = @($temporary)
    if ($published) { $cleanupFiles += $backup }
    foreach ($ownedTemporaryFile in $cleanupFiles) {
        if (Test-Path -LiteralPath $ownedTemporaryFile -PathType Leaf) {
            Remove-Item -LiteralPath $ownedTemporaryFile -Force -ErrorAction SilentlyContinue
        }
    }
}
