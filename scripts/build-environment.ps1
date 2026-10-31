# Shared Windows build prerequisites. Dot-sourcing this file does not install anything.
# Downloads: Node/Python official releases, Google SDK, and Adoptium's official API.

function Invoke-BuildToolProbe {
    param([string]$Program, [string[]]$Arguments)
    if (-not $Program -or -not (Test-Path -LiteralPath $Program -PathType Leaf) -or $Program -match '\\WindowsApps\\') { return $null }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $global:LASTEXITCODE = 0
        $output = (& $Program @Arguments 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { return $null }
        return $output
    } catch { return $null }
    finally { $ErrorActionPreference = $previous }
}

function Get-BuildCommandPath {
    param([string]$Name)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

function Add-BuildProcessPath {
    param([string]$Directory)
    $env:PATH = $Directory + ';' + $env:PATH
}

function Assert-BuildToolChild {
    param([string]$Root, [string]$Path)
    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $fullPath = [IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith($fullRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe build-tool path.' }
    $cursor = $fullPath
    while ($cursor) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -Force -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Refusing a redirected build-tool path.'
        }
        $cursor = Split-Path $cursor -Parent
    }
    return $fullPath
}

function Initialize-BuildToolRoot {
    param([string]$Root)
    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    if (-not $env:LOCALAPPDATA -or $fullRoot -eq [IO.Path]::GetPathRoot($fullRoot).TrimEnd('\')) { throw 'Invalid build-tool root.' }
    Assert-BuildToolChild $fullRoot (Join-Path $fullRoot '.owner') | Out-Null
    $marker = Join-Path $fullRoot '.chipmunks-build-tools'
    if (Test-Path -LiteralPath $fullRoot) {
        if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -Raw -LiteralPath $marker).Trim() -ne 'chipmunks-build-tools-v1') {
            throw "Build-tool directory is not owned by this project: $fullRoot"
        }
    } else {
        New-Item -ItemType Directory -Path $fullRoot -Force | Out-Null
        [IO.File]::WriteAllText($marker, 'chipmunks-build-tools-v1')
    }
    return $fullRoot
}

function Remove-OwnedBuildToolDirectory {
    param([string]$Root, [string]$Path)
    Initialize-BuildToolRoot $Root | Out-Null
    $target = Assert-BuildToolChild $Root $Path
    if (-not (Test-Path -LiteralPath $target)) { return }
    $pending = New-Object 'System.Collections.Generic.Queue[string]'
    $pending.Enqueue($target)
    while ($pending.Count) {
        foreach ($item in Get-ChildItem -Force -LiteralPath $pending.Dequeue()) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a redirected child in a build-tool directory.' }
            if ($item.PSIsContainer) { $pending.Enqueue($item.FullName) }
        }
    }
    Remove-Item -LiteralPath $target -Recurse -Force
}

function Get-VerifiedBuildDownload {
    param([string]$Root, [string]$Url, [string]$FileName, [string]$Hash, [ValidateSet('SHA256','SHA1')][string]$Algorithm = 'SHA256')
    $uri = [Uri]$Url
    if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Host -notin @('nodejs.org','www.python.org','dl.google.com','github.com')) { throw 'Untrusted tool download URL.' }
    if ($FileName -ne [IO.Path]::GetFileName($FileName) -or $FileName -match ':') { throw 'Invalid download filename.' }
    $length = if ($Algorithm -eq 'SHA256') { 64 } else { 40 }
    if ($Hash -notmatch ('^[0-9a-fA-F]{' + $length + '}$')) { throw 'Invalid tool download checksum.' }
    $downloads = Assert-BuildToolChild $Root (Join-Path $Root 'downloads')
    New-Item -ItemType Directory -Path $downloads -Force | Out-Null
    $file = Assert-BuildToolChild $Root (Join-Path $downloads $FileName)
    if ((Test-Path -LiteralPath $file) -and (Get-FileHash -LiteralPath $file -Algorithm $Algorithm).Hash -eq $Hash) {
        Write-Host "[CACHE] $FileName"
        return $file
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $part = Assert-BuildToolChild $Root ($file + '.' + [Guid]::NewGuid().ToString('N') + '.part')
    try {
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            try {
                Write-Host "[DOWNLOAD $attempt/3] $FileName"
                $previousProgress = $ProgressPreference
                $ProgressPreference = 'SilentlyContinue'
                try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $part -TimeoutSec 180 -ErrorAction Stop | Out-Null }
                finally { $ProgressPreference = $previousProgress }
                if ((Get-FileHash -LiteralPath $part -Algorithm $Algorithm).Hash -ne $Hash) { throw 'Downloaded file failed checksum validation.' }
                Move-Item -LiteralPath $part -Destination $file -Force
                return $file
            } catch {
                if ($attempt -eq 3) {
                    $reason = [regex]::Replace($_.Exception.Message, '(?i)(https?://)[^/\s@]+@', '$1***@')
                    throw "Cannot download/verify $FileName after 3 attempts: $reason. Check network/proxy and run again."
                }
            }
        }
    } finally { if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force } }
}

function Expand-BuildToolArchive {
    param([string]$Root, [string]$Archive, [string]$Destination)
    $destinationPath = Assert-BuildToolChild $Root $Destination
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -match ':' -or $entry.FullName.StartsWith('/') -or $entry.FullName.StartsWith('\')) { throw 'Unsafe ZIP entry.' }
            Assert-BuildToolChild $destinationPath (Join-Path $destinationPath $entry.FullName) | Out-Null
        }
    } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $Archive -DestinationPath $destinationPath -Force
}

function Get-CompatibleBuildNode {
    param([string]$Root)
    foreach ($path in @((Get-BuildCommandPath 'node.exe'), (Join-Path $Root 'node/node-v22.23.1-win-x64/node.exe'))) {
        $output = Invoke-BuildToolProbe $path @('-e', "const v=process.versions.node;require('node:sqlite');console.log('BUILD_NODE:'+v+':'+process.arch)")
        if ($output -match 'BUILD_NODE:(22\.(\d+)\.\d+):x64' -and [int]$Matches[2] -ge 14) { return $path }
    }
    return $null
}

function Install-BuildNode {
    param([string]$Root)
    $archive = Get-VerifiedBuildDownload $Root 'https://nodejs.org/dist/v22.23.1/node-v22.23.1-win-x64.zip' 'node-v22.23.1-win-x64.zip' '7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29'
    Expand-BuildToolArchive $Root $archive (Join-Path $Root 'node')
    return (Join-Path $Root 'node/node-v22.23.1-win-x64/node.exe')
}

function Get-CompatibleBuildJdk {
    param([string]$Root)
    $javac = Get-BuildCommandPath 'javac.exe'
    $paths = @($env:JAVA_HOME, (Join-Path $Root 'jdk/current'))
    if ($javac) { $paths += Split-Path (Split-Path $javac -Parent) -Parent }
    foreach ($parent in @((Join-Path $env:ProgramFiles 'Eclipse Adoptium'), (Join-Path $env:ProgramFiles 'Java'), (Join-Path $env:ProgramFiles 'Microsoft'))) {
        if (Test-Path -LiteralPath $parent) { $paths += @(Get-ChildItem -LiteralPath $parent -Directory | Where-Object Name -Match 'jdk.*17' | Select-Object -ExpandProperty FullName) }
    }
    foreach ($path in $paths) {
        if ($path -and (Test-Path -LiteralPath (Join-Path $path 'bin/javac.exe'))) {
            $version = Invoke-BuildToolProbe (Join-Path $path 'bin/java.exe') @('-XshowSettings:properties','-version')
            if ($version -match 'version "17\.' -and $version -match 'sun\.arch\.data\.model\s*=\s*64') { return $path }
        }
    }
    return $null
}

function Install-BuildJdk {
    param([string]$Root)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try { $assets = Invoke-RestMethod -Uri 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse' -TimeoutSec 60 }
    catch { throw 'Cannot read official JDK 17 download metadata. Check network/proxy and run again.' }
    $package = @($assets)[0].binary.package
    if ($package.link -notmatch '^https://github.com/adoptium/temurin17-binaries/releases/download/' -or $package.name -notmatch '^OpenJDK17U-jdk_x64_windows_hotspot_.*\.zip$') { throw 'Unexpected JDK 17 release metadata.' }
    $archive = Get-VerifiedBuildDownload $Root $package.link $package.name $package.checksum
    $stage = Assert-BuildToolChild $Root (Join-Path $Root ('jdk/stage-' + [Guid]::NewGuid().ToString('N')))
    Expand-BuildToolArchive $Root $archive $stage
    $jdk = @(Get-ChildItem -LiteralPath $stage -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/javac.exe') })
    if ($jdk.Count -ne 1) { throw 'JDK archive did not contain exactly one JDK.' }
    $target = Assert-BuildToolChild $Root (Join-Path $Root 'jdk/current')
    if (Test-Path -LiteralPath $target) { Remove-OwnedBuildToolDirectory $Root $target }
    Move-Item -LiteralPath $jdk[0].FullName -Destination $target
    Remove-OwnedBuildToolDirectory $Root $stage
    return $target
}

function Get-BuildSdkMissing {
    param([string]$Sdk)
    $required = @('platforms/android-36/android.jar','platform-tools/adb.exe', 'build-tools/36.0.0/aapt.exe',
        'build-tools/36.0.0/aapt2.exe','build-tools/36.0.0/apksigner.bat','build-tools/36.0.0/zipalign.exe','licenses/android-sdk-license')
    return @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Sdk $_) -PathType Leaf) })
}

function Ensure-BuildSdk {
    param([string]$Root, [switch]$CheckOnly, [switch]$NonInteractive)
    $sdk = $env:ANDROID_HOME
    if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
    if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
    if (@(Get-BuildSdkMissing $sdk).Count -eq 0) { Write-Host "[SKIP] Android SDK 36: $sdk"; return $sdk }
    $ownedSdk = Join-Path $Root 'android-sdk'
    if (@(Get-BuildSdkMissing $ownedSdk).Count -eq 0) { Write-Host "[SKIP] Prepared Android SDK: $ownedSdk"; return $ownedSdk }
    if ($CheckOnly) { throw 'Missing Android SDK 36/build-tools 36.0.0 or SDK licenses. Run prepare-build-environment.ps1 -Target Apk.' }
    if ($NonInteractive -or $env:CHIPMUNKS_APK_GUI -eq '1') {
        throw '[GUI:ATTENTION:SDK_LICENSE] Android SDK components or licenses are missing. Run build-android-release.ps1 -PrepareOnly in a visible window to review the SDK licenses, then retry. No SDK license has been accepted automatically.'
    }
    # An incomplete SDK outside our cache is left intact; prepare the owned SDK.
    $manager = Join-Path $ownedSdk 'cmdline-tools/latest/bin/sdkmanager.bat'
    if (-not (Test-Path -LiteralPath $manager)) {
        $archive = Get-VerifiedBuildDownload $Root 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' 'commandlinetools-win-15859902_latest.zip' 'b9862337a13e2809a5159dc3a08d058091bd59f6' 'SHA1'
        $stage = Assert-BuildToolChild $Root (Join-Path $Root ('sdk-stage-' + [Guid]::NewGuid().ToString('N')))
        Expand-BuildToolArchive $Root $archive $stage
        $target = Assert-BuildToolChild $Root (Join-Path $ownedSdk 'cmdline-tools/latest')
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        if (Test-Path -LiteralPath $target) { Remove-OwnedBuildToolDirectory $Root $target }
        Move-Item -LiteralPath (Join-Path $stage 'cmdline-tools') -Destination $target
        Remove-OwnedBuildToolDirectory $Root $stage
    }
    Write-Host '[SDK] Review the SDK licenses in this window; accept to continue.'
    & $manager "--sdk_root=$ownedSdk" --licenses
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $ownedSdk 'licenses/android-sdk-license'))) { throw 'SDK licenses were not accepted; build stopped.' }
    & $manager "--sdk_root=$ownedSdk" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
    if ($LASTEXITCODE -ne 0 -or @(Get-BuildSdkMissing $ownedSdk).Count) { throw 'Android SDK preparation failed. Check the network and rerun; downloaded packages are reused.' }
    return $ownedSdk
}

function Test-CompatibleBuildPythonPath {
    param([string]$Path)
    $output = Invoke-BuildToolProbe $Path @('-c', "import sys,struct,venv,ensurepip;print('BUILD_PYTHON:%s.%s:%s' % (sys.version_info[0],sys.version_info[1],struct.calcsize('P')*8))")
    return ($output -match 'BUILD_PYTHON:3\.(10|11|12):64')
}

function Get-CompatibleBuildPython {
    param([string]$Root)
    $paths = @((Get-BuildCommandPath 'python.exe'), (Join-Path $Root 'python312/python.exe'))
    foreach ($version in @('312','311','310')) {
        $paths += Join-Path $env:LOCALAPPDATA "Programs/Python/Python$version/python.exe"
        $paths += Join-Path $env:ProgramFiles "Python$version/python.exe"
    }
    foreach ($registryRoot in @('HKCU:\Software\Python\PythonCore', 'HKLM:\Software\Python\PythonCore')) {
        foreach ($version in @('3.12','3.11','3.10')) {
            $key = Join-Path $registryRoot "$version\InstallPath"
            if (Test-Path -LiteralPath $key) {
                $registered = (Get-Item -LiteralPath $key).GetValue('')
                if ($registered) { $paths += Join-Path $registered 'python.exe' }
            }
        }
    }
    foreach ($path in $paths) {
        if (Test-CompatibleBuildPythonPath $path) { return $path }
    }
    return $null
}

function Test-SyncBuildDependencies {
    param([string]$Python, [string]$RequirementsFile)
    $check = "import sys,importlib,importlib.metadata as m; r=[x.strip().split('==') for x in open(sys.argv[1],encoding='utf-8-sig') if x.strip() and not x.startswith('#')]; assert all(m.version(p)==v for p,v in r); [importlib.import_module(p) for p in ('cherrypy','openpyxl','pystray','PIL','qrcode','win32print','PyInstaller')]; print('BUILD_DEPS_OK')"
    return ((Invoke-BuildToolProbe $Python @('-c', $check, $RequirementsFile)) -match 'BUILD_DEPS_OK')
}

function Test-SyncBuildTkRuntime {
    param([string]$Python)
    # Loading Tk verifies both the Python module and Tcl/Tk's bundled data files.
    # Withdraw before processing events so a build check never displays a window.
    $check = "import tkinter,tkinter.ttk; root=tkinter.Tk(); root.withdraw(); assert root.tk.call('package','require','Tk'); root.destroy(); print('BUILD_TK_OK')"
    return ((Invoke-BuildToolProbe $Python @('-c', $check)) -match 'BUILD_TK_OK')
}

function Ensure-SyncBuildPython {
    param([string]$Root, [string]$RequirementsFile, [switch]$CheckOnly)
    $python = Get-CompatibleBuildPython $Root
    if (-not $python -or -not (Test-SyncBuildTkRuntime $python)) {
        if ($CheckOnly) {
            if ($python) { throw 'Missing Tcl/Tk runtime for the pairing settings window. Run prepare-build-environment.ps1 -Target Sync to repair a project-owned runtime. For an external Python installation, open its installer, choose Modify, and enable Tcl/Tk and IDLE.' }
            throw 'Missing compatible Python 3.10-3.12 x64. Run prepare-build-environment.ps1 -Target Sync.'
        }
        # Leave external Python installations alone. Reuse or prepare our own full
        # runtime when an otherwise compatible system Python omitted Tcl/Tk.
        $target = Assert-BuildToolChild $Root (Join-Path $Root 'python312')
        $managedPython = Join-Path $target 'python.exe'
        $managedCompatible = Test-CompatibleBuildPythonPath $managedPython
        if ($python -and -not $managedCompatible -and [IO.Path]::GetFullPath($python) -ne [IO.Path]::GetFullPath($managedPython)) {
            throw 'Missing Tcl/Tk in the existing Python installation. Open the Python installer, choose Modify, and enable Tcl/Tk and IDLE, then rerun. The external Python installation has not been changed.'
        }
        if (-not $managedCompatible -or -not (Test-SyncBuildTkRuntime $managedPython)) {
            $installer = Get-VerifiedBuildDownload $Root 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' 'python-3.12.10-amd64.exe' '67b5635e80ea51072b87941312d00ec8927c4db9ba18938f7ad2d27b328b95fb'
            $arguments = @('/quiet','InstallAllUsers=0', ('TargetDir="{0}"' -f $target),
                'PrependPath=0','Include_launcher=0','Include_test=0','Include_tcltk=1','Include_pip=1','Shortcuts=0','AssociateFiles=0')
            if ($managedCompatible) { $arguments = @('/modify') + $arguments }
            $process = Start-Process -FilePath $installer -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
            if ($process.ExitCode -notin @(0,3010)) { throw "Python preparation failed (exit $($process.ExitCode))." }
        }
        $python = $managedPython
        if (-not (Test-CompatibleBuildPythonPath $python) -or -not (Test-SyncBuildTkRuntime $python)) { throw 'Prepared Python with Tcl/Tk could not be verified. A restart or Python installation repair may be required.' }
    }
    if (Test-SyncBuildDependencies $python $RequirementsFile) { Write-Host "[SKIP] Python and sync build packages: $python"; return $python }
    $venv = Assert-BuildToolChild $Root (Join-Path $Root 'sync-venv')
    $venvPython = Join-Path $venv 'Scripts/python.exe'
    if ((Test-CompatibleBuildPythonPath $venvPython) -and (Test-SyncBuildTkRuntime $venvPython) -and (Test-SyncBuildDependencies $venvPython $RequirementsFile)) { Write-Host "[SKIP] Sync build virtual environment: $venvPython"; return $venvPython }
    if ($CheckOnly) { throw 'Missing/mismatched sync build packages. Run prepare-build-environment.ps1 -Target Sync.' }
    if (-not (Test-CompatibleBuildPythonPath $venvPython) -or -not (Test-SyncBuildTkRuntime $venvPython)) {
        if (Test-Path -LiteralPath $venv) { Remove-OwnedBuildToolDirectory $Root $venv }
        & $python -m venv $venv
        if ($LASTEXITCODE -ne 0) { throw 'Cannot create the sync build virtual environment.' }
    }
    & $venvPython -m pip install --disable-pip-version-check --only-binary=:all: --force-reinstall -r $RequirementsFile
    if ($LASTEXITCODE -ne 0 -or -not (Test-SyncBuildDependencies $venvPython $RequirementsFile) -or -not (Test-SyncBuildTkRuntime $venvPython)) { throw 'Sync build package or Tcl/Tk preparation failed. Check network/proxy and run again.' }
    return $venvPython
}

function Ensure-BuildEnvironment {
    param([ValidateSet('Apk','Sync','Both')][string]$Target, [switch]$CheckOnly, [switch]$NonInteractive,
        [string]$ToolRoot = (Join-Path $env:LOCALAPPDATA 'ChipmunksBuildTools'),
        [string]$RequirementsFile = (Join-Path $PSScriptRoot 'sync-build-requirements.txt'))
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($env:OS -ne 'Windows_NT' -or $arch -ne 'AMD64') { throw 'Build preparation supports Windows x64 (Intel/AMD) only.' }
    $prepareLock = $null
    if (-not $CheckOnly) {
        $ToolRoot = Initialize-BuildToolRoot $ToolRoot
        try { $prepareLock = [IO.File]::Open((Join-Path $ToolRoot 'prepare.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
        catch { throw 'Another build environment preparation is running. Wait for it to finish before retrying.' }
    }
    try {
    $result = @{}
    if ($Target -in @('Apk','Both')) {
        $node = Get-CompatibleBuildNode $ToolRoot
        if (-not $node) {
            if ($CheckOnly) { throw 'Missing compatible Node.js 22.14+ with node:sqlite.' }
            Initialize-BuildToolRoot $ToolRoot | Out-Null
            $node = Install-BuildNode $ToolRoot
            if (-not (Get-CompatibleBuildNode $ToolRoot)) { throw 'Prepared Node.js could not be verified.' }
        }
        Write-Host "[SKIP/READY] Node.js: $node"
        Add-BuildProcessPath (Split-Path $node -Parent)
        $pnpm = Get-BuildCommandPath 'pnpm.cmd'
        $previousCorepackNetwork = $env:COREPACK_ENABLE_NETWORK
        $env:COREPACK_ENABLE_NETWORK = '0'
        try { $pnpmVersion = Invoke-BuildToolProbe $pnpm @('--version') }
        finally { $env:COREPACK_ENABLE_NETWORK = $previousCorepackNetwork }
        $ownedPnpm = Join-Path $ToolRoot 'bin/pnpm.cmd'
        if ($pnpmVersion -ne '9.0.0' -and (Test-Path -LiteralPath $ownedPnpm)) {
            $env:COREPACK_HOME = Join-Path $ToolRoot 'corepack'
            $env:COREPACK_ENABLE_NETWORK = '0'
            try { $pnpmVersion = Invoke-BuildToolProbe $ownedPnpm @('--version') }
            finally { $env:COREPACK_ENABLE_NETWORK = $previousCorepackNetwork }
            if ($pnpmVersion -eq '9.0.0') { $pnpm = $ownedPnpm; Add-BuildProcessPath (Split-Path $pnpm -Parent) }
        }
        if ($pnpmVersion -ne '9.0.0') {
            if ($CheckOnly) { throw 'Missing pnpm 9.0.0 (project packageManager version).' }
            Initialize-BuildToolRoot $ToolRoot | Out-Null
            $corepack = Join-Path (Split-Path $node -Parent) 'corepack.cmd'
            if (-not (Test-Path -LiteralPath $corepack)) { $node = Install-BuildNode $ToolRoot; Add-BuildProcessPath (Split-Path $node -Parent); $corepack = Join-Path (Split-Path $node -Parent) 'corepack.cmd' }
            $env:COREPACK_HOME = Assert-BuildToolChild $ToolRoot (Join-Path $ToolRoot 'corepack')
            $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
            $env:COREPACK_ENABLE_NETWORK = '1'
            try { & $corepack prepare pnpm@9.0.0 --activate }
            finally { $env:COREPACK_ENABLE_NETWORK = $previousCorepackNetwork }
            if ($LASTEXITCODE -ne 0) { throw 'pnpm preparation failed. Check network/proxy and rerun.' }
            $bin = Assert-BuildToolChild $ToolRoot (Join-Path $ToolRoot 'bin')
            New-Item -ItemType Directory -Path $bin -Force | Out-Null
            $pnpm = Join-Path $bin 'pnpm.cmd'
            [IO.File]::WriteAllText($pnpm, ('@echo off' + "`r`n" + 'chcp 65001 >nul' + "`r`n" + 'call "' + $corepack + '" pnpm@9.0.0 %*' + "`r`n"), [Text.UTF8Encoding]::new($false))
            Add-BuildProcessPath $bin
            if ((Invoke-BuildToolProbe $pnpm @('--version')) -ne '9.0.0') { throw 'Prepared pnpm could not be verified.' }
        }
        Write-Host "[SKIP/READY] pnpm 9.0.0: $pnpm"
        $jdk = Get-CompatibleBuildJdk $ToolRoot
        if (-not $jdk) {
            if ($CheckOnly) { throw 'Missing JDK 17 (JAVA_HOME or a compatible installed JDK).' }
            Initialize-BuildToolRoot $ToolRoot | Out-Null
            $jdk = Install-BuildJdk $ToolRoot
            if (-not (Get-CompatibleBuildJdk $ToolRoot)) { throw 'Prepared JDK 17 could not be verified.' }
        }
        $env:JAVA_HOME = $jdk
        Add-BuildProcessPath (Join-Path $jdk 'bin')
        Write-Host "[SKIP/READY] JDK 17: $jdk"
        if (-not $CheckOnly) { Initialize-BuildToolRoot $ToolRoot | Out-Null }
        $sdk = Ensure-BuildSdk $ToolRoot -CheckOnly:$CheckOnly -NonInteractive:$NonInteractive
        $env:ANDROID_HOME = $sdk
        $env:ANDROID_SDK_ROOT = $sdk
        $result.node = $node; $result.pnpm = $pnpm; $result.jdk = $jdk; $result.sdk = $sdk
    }
    if ($Target -in @('Sync','Both')) {
        if (-not (Test-Path -LiteralPath $RequirementsFile)) { throw 'Missing sync-build-requirements.txt.' }
        if (-not $CheckOnly) { Initialize-BuildToolRoot $ToolRoot | Out-Null }
        $result.python = Ensure-SyncBuildPython $ToolRoot $RequirementsFile -CheckOnly:$CheckOnly
    }
    Write-Host "ENVIRONMENT READY: $Target" -ForegroundColor Green
    return [pscustomobject]$result
    } finally { if ($prepareLock) { $prepareLock.Dispose() } }
}
