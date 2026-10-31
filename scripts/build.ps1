param([switch]$CheckOnly, [switch]$PrepareOnly, [switch]$NonInteractive)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$OutputEncoding = [Text.Encoding]::UTF8
$repo = Split-Path $PSScriptRoot -Parent
$NonInteractive = $NonInteractive -or $env:CHIPMUNKS_BUILD_GUI -eq '1' -or $env:CHIPMUNKS_APK_GUI -eq '1'
$lock = $null; $transcript = $false; $runRoot = $null; $retainRun = $false
$publishedFiles = New-Object Collections.Generic.List[object]
$publicationMutex = $null; $ownsPublicationMutex = $false
$previousProgressPreference = $ProgressPreference
$hadPythonUtf8 = Test-Path Env:PYTHONUTF8
$previousPythonUtf8 = $env:PYTHONUTF8
$hadPythonIoEncoding = Test-Path Env:PYTHONIOENCODING
$previousPythonIoEncoding = $env:PYTHONIOENCODING

function Assert-SyncDirectory {
    param([string]$Path)
    $absolute = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $parent = $absolute
    while ($parent) {
        if ([IO.Directory]::Exists($parent) -and
            (([IO.File]::GetAttributes($parent) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw "Refusing a redirected sync build directory: $parent"
        }
        $next = [IO.Path]::GetDirectoryName($parent)
        if ($next -eq $parent) { break }
        $parent = $next
    }
    return $absolute
}

function Get-SyncHash {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path); $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Assert-SyncExecutable {
    param([string]$Path)
    if (-not [IO.File]::Exists($Path)) { throw 'PyInstaller did not produce an executable.' }
    $stream = [IO.File]::OpenRead($Path); $reader = New-Object IO.BinaryReader($stream)
    try {
        if ($stream.Length -lt 68 -or $reader.ReadUInt16() -ne 0x5a4d) { throw 'Sync executable verification failed: missing MZ header.' }
        $stream.Position = 60; $peOffset = $reader.ReadInt32()
        if ($peOffset -lt 64 -or $peOffset -gt $stream.Length - 4) { throw 'Sync executable verification failed: invalid PE offset.' }
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x4550) { throw 'Sync executable verification failed: missing PE signature.' }
    } finally { $reader.Dispose(); $stream.Dispose() }
}

function Remove-OwnedSyncRun {
    param([string]$Path, [string]$TemporaryRoot)
    if (-not $Path -or -not [IO.Directory]::Exists($Path)) { return }
    $root = Assert-SyncDirectory $TemporaryRoot; $target = Assert-SyncDirectory $Path
    if (-not $target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetDirectoryName($target) -ne $root -or
        -not [IO.File]::Exists((Join-Path $target '.chipmunks-sync-build-run'))) {
        throw 'Refusing to clean an unowned sync build directory.'
    }
    foreach ($item in @(Get-ChildItem -LiteralPath $target -Force -Recurse)) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Temporary files include a redirected path; leaving this run for inspection.'
        }
    }
    Remove-Item -LiteralPath $target -Recurse -Force
}

try {
    if ($CheckOnly -and $PrepareOnly) { throw 'Choose either -CheckOnly or -PrepareOnly.' }
    # GUI readers decode UTF-8. Change only this build process and its Python children.
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    if ($NonInteractive) { $ProgressPreference = 'SilentlyContinue' }
    Set-Location -LiteralPath $PSScriptRoot
    # Hold the same lock throughout preparation and packaging. Checks remain read-only.
    if (-not $CheckOnly) {
        $logDir = Assert-SyncDirectory (Join-Path $repo 'logs/sync-build')
        [IO.Directory]::CreateDirectory($logDir) | Out-Null
        try { $lock = [IO.File]::Open((Join-Path $logDir 'build.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
        catch { throw 'Another sync build or preparation is running. Wait for it to finish.' }
        $stamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
        Start-Transcript -Path (Join-Path $logDir "$stamp.log") | Out-Null; $transcript = $true
    }
    Write-Host '[1/4] Preparing verified sync build dependencies...'
    . (Join-Path $PSScriptRoot 'build-environment.ps1')
    $environment = Ensure-BuildEnvironment -Target Sync -CheckOnly:$CheckOnly -NonInteractive:$NonInteractive
    if ($CheckOnly) { Write-Output 'CHECK PASSED: Sync build environment ready.'; exit 0 }
    if ($PrepareOnly) { Write-Output 'SYNC ENVIRONMENT READY. No EXE build started.'; exit 0 }
    $python = $environment.python
    if ([string]::IsNullOrWhiteSpace($python)) { throw 'Sync build environment did not return Python.' }

    Write-Host '[2/4] Checking sync source, version and label resources...'
    $source = Join-Path $PSScriptRoot 'label_sync_server.py'
    if (-not [IO.File]::Exists($source)) { throw 'Missing scripts/label_sync_server.py.' }
    $versionMatch = [regex]::Match([IO.File]::ReadAllText($source), '(?m)^SYNC_VERSION\s*=\s*[''"]([A-Za-z0-9][A-Za-z0-9._-]{0,39})[''"]\s*$')
    if (-not $versionMatch.Success) { throw 'Cannot read SYNC_VERSION from sync source. No version was changed.' }
    $version = $versionMatch.Groups[1].Value; Write-Host "SYNC VERSION: $version"
    $iconPath = Join-Path $PSScriptRoot 'icon.ico'
    $assetsPath = Assert-SyncDirectory (Join-Path $PSScriptRoot 'assets')
    if (-not [IO.Directory]::Exists($assetsPath)) { throw 'Missing sync label asset directory: scripts/assets.' }
    foreach ($assetName in @('geehy-logo.png', 'boya-logo.png', 'pb-logo.png', 'union-logo.png', 'esd-warning.png', 'keep-dry.png', 'wch-logo.png', 'dongwei-logo.png', 'rongpai-logo.png', 'linearin-logo.png')) {
        if (-not [IO.File]::Exists((Join-Path $assetsPath $assetName))) { throw "Missing sync label asset: $assetName" }
    }
    $appName = '掌上仓库ERP版同步助手'
    $temporaryRoot = Assert-SyncDirectory (Join-Path $PSScriptRoot '.sync-build-temp')
    [IO.Directory]::CreateDirectory($temporaryRoot) | Out-Null
    $runRoot = Join-Path $temporaryRoot ($stamp + '_' + [guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($runRoot) | Out-Null
    [IO.File]::WriteAllText((Join-Path $runRoot '.chipmunks-sync-build-run'), 'chipmunks-sync-build-v1')
    $packagedDir = Join-Path $runRoot 'dist'
    $pyInstallerArgs = @('--noconfirm', '--onefile', '--windowed', '--log-level', 'WARN',
        '--hidden-import', 'win32print', '--hidden-import', 'pywintypes', '--collect-all', 'qrcode',
        '--name', $appName, '--distpath', $packagedDir, '--workpath', (Join-Path $runRoot 'work'),
        '--specpath', (Join-Path $runRoot 'spec'))
    if ([IO.File]::Exists($iconPath)) { $pyInstallerArgs += @('--icon', $iconPath, '--add-data', "$iconPath;.") }
    else { Write-Host '[WARN] Missing icon.ico; the default executable icon will be used.' }
    $pyInstallerArgs += @('--add-data', "$assetsPath;assets", $source)

    Write-Host '[3/4] Packaging sync executable with PyInstaller...'
    $global:LASTEXITCODE = 0
    & $python -m PyInstaller @pyInstallerArgs
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed (exit $LASTEXITCODE). The previous sync executable was preserved." }
    Write-Host '[4/4] Verifying and saving sync executable...'
    $packagedExe = Join-Path $packagedDir "$appName.exe"
    Assert-SyncExecutable $packagedExe; $hash = Get-SyncHash $packagedExe
    $dist = Assert-SyncDirectory (Join-Path $PSScriptRoot 'dist')
    [IO.Directory]::CreateDirectory($dist) | Out-Null
    # Publish one stable filename. Stage and recovery files stay outside the delivery folder.
    $delivery = Join-Path $dist "$appName.exe"
    $shaFile = $delivery + '.sha256'; $verificationFile = $delivery + '.verification.json'
    $buildId = $env:CHIPMUNKS_BUILD_TASK_ID
    if ([string]::IsNullOrWhiteSpace($buildId)) { $buildId = [guid]::NewGuid().ToString('N') }
    if ($buildId -notmatch '^[a-fA-F0-9]{32}$') { throw 'Invalid build task identifier. The previous sync executable was preserved.' }
    $stageRoot = Join-Path $runRoot 'publish'; [IO.Directory]::CreateDirectory($stageRoot) | Out-Null
    $stagedExe = Join-Path $stageRoot "$appName.exe"
    [IO.File]::Copy($packagedExe, $stagedExe, $false)
    Assert-SyncExecutable $stagedExe
    if ((Get-SyncHash $stagedExe) -ne $hash) { throw 'The staged sync executable hash does not match its verified source.' }
    $stagedSha = $stagedExe + '.sha256'; $stagedVerification = $stagedExe + '.verification.json'
    [IO.File]::WriteAllText($stagedSha, ($hash + '  ' + [IO.Path]::GetFileName($delivery) + "`r`n"), [Text.UTF8Encoding]::new($false))
    $verification = [ordered]@{ version = $version; buildId = $buildId; builtAt = (Get-Date).ToString('o'); file = [IO.Path]::GetFileName($delivery);
        length = ([IO.FileInfo]$stagedExe).Length; sha256 = $hash; peHeaderVerified = $true; source = 'scripts/label_sync_server.py' }
    [IO.File]::WriteAllText($stagedVerification, ($verification | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    # Commit the EXE last; undo metadata replacements if the EXE is locked or publication fails.
    $publications = @(
        @{ staged = $stagedSha; destination = $shaFile },
        @{ staged = $stagedVerification; destination = $verificationFile },
        @{ staged = $stagedExe; destination = $delivery }
    )
    # The GUI defers cancellation while this brief publication section owns the mutex.
    # Taking the same mutex before terminating the job also closes the entry race.
    $publicationMutex = [Threading.Mutex]::new($false, ('Local\ChipmunksSyncPublish_' + $buildId))
    try { $ownsPublicationMutex = $publicationMutex.WaitOne(30000) }
    catch [Threading.AbandonedMutexException] { $ownsPublicationMutex = $true }
    if (-not $ownsPublicationMutex) { throw 'Could not enter the sync publication section. The previous EXE was preserved.' }
    try {
        foreach ($publication in $publications) {
            $destination = $publication.destination
            if (([IO.File]::Exists($destination) -or [IO.Directory]::Exists($destination)) -and
                (([IO.File]::GetAttributes($destination) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
                throw 'Refusing a redirected sync delivery file.'
            }
            $existed = [IO.File]::Exists($destination)
            $backup = Join-Path $stageRoot ([guid]::NewGuid().ToString('N') + '.previous')
            if ($existed) { [IO.File]::Replace($publication.staged, $destination, $backup) }
            else { [IO.File]::Move($publication.staged, $destination) }
            $publishedFiles.Add(@{ destination = $destination; existed = $existed; backup = $backup })
        }
        Assert-SyncExecutable $delivery
        if ((Get-SyncHash $delivery) -ne $hash) { throw 'The published sync executable failed hash verification.' }
    } catch {
        $publicationError = $_.Exception.Message
        for ($index = $publishedFiles.Count - 1; $index -ge 0; $index--) {
            $published = $publishedFiles[$index]
            try {
                if ($published.existed) {
                    if ([IO.File]::Exists($published.destination)) { [IO.File]::Replace($published.backup, $published.destination, $published.backup + '.rollback') }
                    else { [IO.File]::Move($published.backup, $published.destination) }
                } elseif ([IO.File]::Exists($published.destination)) { [IO.File]::Delete($published.destination) }
            } catch {
                $retainRun = $true
                Write-Host ('[WARN] Recovery files retained in ' + $stageRoot + ': ' + $_.Exception.Message)
            }
        }
        throw ('Could not publish the sync EXE. Close the running sync helper and retry; check file permissions if it is already closed. No alternative EXE was created. Details: ' + $publicationError)
    }
    Write-Output 'BUILD SUCCEEDED'
    Write-Output "EXE: $delivery"
    Write-Output "SHA256: $hash"
    Write-Output "EXE-BUILD-ID: $buildId"
    Write-Output "VERIFICATION: $verificationFile"
    exit 0
} catch { Write-Host ('BUILD FAILED: ' + $_.Exception.Message); exit 1 }
finally {
    if ($ownsPublicationMutex) { $publicationMutex.ReleaseMutex() }
    if ($publicationMutex) { $publicationMutex.Dispose() }
    if ($runRoot -and -not $retainRun) {
        try { Remove-OwnedSyncRun $runRoot $temporaryRoot }
        catch { Write-Host ('[WARN] Temporary files retained: ' + $_.Exception.Message) }
    }
    if ($transcript) { try { Stop-Transcript | Out-Null } catch { } }
    if ($lock) { $lock.Dispose() }
    $ProgressPreference = $previousProgressPreference
    if ($hadPythonUtf8) { $env:PYTHONUTF8 = $previousPythonUtf8 } else { Remove-Item Env:PYTHONUTF8 -ErrorAction SilentlyContinue }
    if ($hadPythonIoEncoding) { $env:PYTHONIOENCODING = $previousPythonIoEncoding } else { Remove-Item Env:PYTHONIOENCODING -ErrorAction SilentlyContinue }
}
