param([switch]$CheckOnly, [switch]$SyncOnly, [switch]$PrepareOnly, [switch]$NonInteractive)

$ErrorActionPreference = 'Stop'
# A hidden GUI child has redirected streams and may have no console handle.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path $PSScriptRoot -Parent
$lock = $null
$transcript = $false
$hadUpdateServerEnv = Test-Path Env:UPDATE_SERVER_URL
$previousUpdateServerEnv = $env:UPDATE_SERVER_URL
$hadCiEnv = Test-Path Env:CI
$previousCiEnv = $env:CI
$NonInteractive = $NonInteractive -or $env:CHIPMUNKS_APK_GUI -eq '1'
$hadCorepackPromptEnv = Test-Path Env:COREPACK_ENABLE_DOWNLOAD_PROMPT
$previousCorepackPromptEnv = $env:COREPACK_ENABLE_DOWNLOAD_PROMPT
$previousProgressPreference = $ProgressPreference
$managedSigning = $null
$releaseEnvironment = @{}
foreach ($name in @('CHIPMUNKS_RELEASE_STORE_FILE','CHIPMUNKS_RELEASE_STORE_PASSWORD','CHIPMUNKS_RELEASE_KEY_ALIAS','CHIPMUNKS_RELEASE_KEY_PASSWORD')) {
    $releaseEnvironment[$name] = [pscustomobject]@{ Exists = (Test-Path "Env:$name"); Value = [Environment]::GetEnvironmentVariable($name, 'Process') }
}

function Protect-BuildOutput {
    param([object]$Message)
    return [regex]::Replace([string]$Message, '(?i)(https?://)[^/\s@]+@', '$1***@')
}

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    Get-Command $Program -ErrorAction Stop | Out-Null
    $global:LASTEXITCODE = 0
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Program @Arguments 2>&1 | ForEach-Object { Write-Host (Protect-BuildOutput $_) }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    if ($code -ne 0) { throw "$Program failed (exit $code). See the build log." }
}

function Assert-BuildSources {
    param([string]$SourceRoot)
    foreach ($file in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'client/package.json', 'server/package.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot $file) -PathType Leaf)) {
            throw "Missing required build input: $file"
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'client/android') -PathType Container)) {
        throw 'Missing required build input: client/android'
    }
    $patches = Join-Path $SourceRoot 'patches'
    if (Test-Path -LiteralPath $patches) {
        if (-not (Test-Path -LiteralPath $patches -PathType Container)) {
            throw 'Build input patches must be a directory.'
        }
    } else {
        # No patches folder is needed unless a dependency manifest or lockfile references it.
        foreach ($manifest in @('package.json', 'client/package.json', 'server/package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml')) {
            $content = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $SourceRoot $manifest)
            if ($content -match 'patches[/\\]') {
                throw "Missing patches directory referenced by $manifest. Restore the required dependency patches."
            }
        }
    }
}

function Get-PrivateNasUpdateServer {
    param([string]$ConfigPath)
    if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        throw 'Missing updateServerFile in android-build.local. Restore the private NAS configuration.'
    }
    try {
        $privateUpdateConfig = Get-Content -Raw -Encoding UTF8 -LiteralPath $ConfigPath | ConvertFrom-Json
        $releaseUpdateServer = ([string]$privateUpdateConfig.defaultServer).Trim().TrimEnd('/')
    } catch {
        throw 'Cannot read the private NAS update configuration. Restore update-server.local.json.'
    }
    $releaseServerUri = $null
    if (-not [Uri]::TryCreate($releaseUpdateServer, [UriKind]::Absolute, [ref]$releaseServerUri) -or
        $releaseServerUri.Scheme -notin @('https', 'http') -or -not $releaseServerUri.Host -or
        $releaseUpdateServer -match '%(?![0-9a-fA-F]{2})') {
        throw 'The private NAS configuration must contain a valid HTTP(S) defaultServer URL.'
    }
    $releaseAuthParts = $releaseServerUri.UserInfo -split ':', 2
    if ($releaseAuthParts.Count -ne 2 -or -not $releaseAuthParts[0] -or -not $releaseAuthParts[1]) {
        throw 'The private NAS URL is missing valid username/password authentication.'
    }
    # Encode each credential separately so native URLDecoder preserves literal + and reserved characters.
    $releaseUser = [Uri]::EscapeDataString([Uri]::UnescapeDataString($releaseAuthParts[0]))
    $releasePassword = [Uri]::EscapeDataString([Uri]::UnescapeDataString($releaseAuthParts[1]))
    return ('{0}://{1}:{2}@{3}{4}{5}' -f $releaseServerUri.Scheme, $releaseUser, $releasePassword,
        $releaseServerUri.Authority, $releaseServerUri.PathAndQuery, $releaseServerUri.Fragment)
}

function Sync-BuildSourceFolder {
    param([string]$SourceRoot, [string]$CacheRoot, [ValidateSet('client', 'patches')][string]$Folder)
    $cache = [IO.Path]::GetFullPath($CacheRoot).TrimEnd('\')
    $target = [IO.Path]::GetFullPath((Join-Path $cache $Folder))
    if (-not $target.StartsWith($cache + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Unsafe mirror target.'
    }
    if ((Test-Path -LiteralPath $target) -and
        ((Get-Item -Force -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Refusing a redirected build directory: $target"
    }
    $source = Join-Path $SourceRoot $Folder
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        if ($Folder -ne 'patches') { throw "Missing required source directory: $Folder" }
        # Match the source tree instead of keeping obsolete patches in the dedicated cache.
        if (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
        Write-Host 'Optional patches directory is absent; no dependency patches to synchronize.'
        $global:LASTEXITCODE = 0
        return
    }
    & robocopy.exe $source $target /MIR /XJ /XD node_modules build .cxx .gradle .expo .git /XF .env .env.* *.log *.tsbuildinfo local.properties /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw "Source synchronization failed: $Folder" }
}

try {
    if (@(@($CheckOnly, $SyncOnly, $PrepareOnly) | Where-Object { $_ }).Count -gt 1) { throw 'Choose only one of -CheckOnly, -SyncOnly or -PrepareOnly.' }
    if ($NonInteractive) {
        $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
        $ProgressPreference = 'SilentlyContinue'
    }
    if (-not $PrepareOnly) { Assert-BuildSources $repo }
    # Both the CMD fallback and GUI own the same lock for preparation and build.
    # Keep CheckOnly read-only: it neither creates logs nor acquires a write lock.
    if (-not $CheckOnly) {
        $stamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
        $logDir = Join-Path $repo 'logs/android-build'
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        try { $lock = [IO.File]::Open((Join-Path $logDir 'build.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
        catch { throw 'Another APK build is running. Do not start a second build.' }
        Start-Transcript -Path (Join-Path $logDir "$stamp.log") | Out-Null
        $transcript = $true
    }
    if (-not $SyncOnly) {
        . (Join-Path $PSScriptRoot 'build-environment.ps1')
        Ensure-BuildEnvironment -Target Apk -CheckOnly:$CheckOnly -NonInteractive:$NonInteractive | Out-Null
        if ($PrepareOnly) { Write-Host 'APK ENVIRONMENT READY. No APK build started.'; exit 0 }
    }
    $configFile = Join-Path $repo 'android-build.local'
    if (-not (Test-Path -LiteralPath $configFile)) {
        throw 'Missing android-build.local. See docs/local-android-build.md.'
    }
    $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configFile | ConvertFrom-Json
    $buildRoot = [IO.Path]::GetFullPath($config.buildRoot).TrimEnd('\')
    # Only a dedicated, short, top-level cw-* directory may be mirrored.
    if ($buildRoot -notmatch '^[A-Za-z]:\\cw-[A-Za-z0-9_-]+$' -or
        $repo.StartsWith($buildRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or $repo -eq $buildRoot) {
        throw 'Unsafe buildRoot. Use a dedicated directory such as D:\cw-android, outside the project.'
    }
    $marker = Join-Path $buildRoot '.chipmunks-build-cache'
    if (Test-Path -LiteralPath $buildRoot) {
        if (-not (Test-Path -LiteralPath $marker) -or
            (Get-Content -Raw -LiteralPath $marker).Trim() -ne 'chipmunks-android-build-v1') {
            throw 'Build directory is not an owned APK cache. Choose a new empty path in android-build.local.'
        }
    }
    foreach ($directory in @($buildRoot, (Join-Path $buildRoot 'client'), (Join-Path $buildRoot 'server'), (Join-Path $buildRoot 'patches'))) {
        if ((Test-Path -LiteralPath $directory) -and
            ((Get-Item -Force -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing a redirected build directory: $directory"
        }
    }
    $sdk = $env:ANDROID_HOME
    if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
    if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
    $buildTools = Join-Path $sdk 'build-tools/36.0.0'
    if (-not $SyncOnly) {
        $pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) {
            throw 'JAVA_HOME is missing or invalid. Install/configure JDK 17 first.'
        }
        foreach ($tool in @('aapt.exe', 'aapt2.exe', 'apksigner.bat', 'zipalign.exe')) {
            if (-not (Test-Path -LiteralPath (Join-Path $buildTools $tool))) { throw "Missing Android SDK tool: $tool" }
        }
        $managedLibrary = Join-Path $PSScriptRoot 'managed-signing.ps1'
        if (-not (Test-Path -LiteralPath $managedLibrary -PathType Leaf)) { throw 'Missing managed-signing.ps1. Restore the complete build tool project.' }
        . $managedLibrary
        $managedSigning = Get-ManagedSigning -RepositoryPath $repo -MetadataOnly:$CheckOnly
        if ($managedSigning) {
            $signing = $managedSigning.Signing
            Write-Host '[SIGNING] Using the verified signing profile managed by the build tool.'
        } else {
            try { $signing = Get-Content -Raw -Encoding UTF8 -LiteralPath $config.signingFile | ConvertFrom-Json }
            catch { throw 'Cannot read release signing. Import the existing signing configuration in the build tool.' }
        }
        foreach ($field in @('storeFile', 'storePassword', 'keyAlias', 'keyPassword')) {
            if ([string]::IsNullOrWhiteSpace($signing.$field)) { throw "Missing signing field: $field" }
        }
        if (-not (Test-Path -LiteralPath $signing.storeFile)) { throw 'Release keystore was not found.' }
        $releaseUpdateServer = Get-PrivateNasUpdateServer -ConfigPath $config.updateServerFile
        if ($CheckOnly) {
            Write-Host "CHECK PASSED: ARM64 release; cache=$buildRoot; source inputs, local signing and private NAS authentication available. No build started."
            exit 0
        }
    }

    Invoke-Checked 'node' @((Join-Path $repo 'scripts/ota-runtime.cjs'), '--prepare')
    Write-Host '[1/5] Synchronizing latest source into the dedicated build cache...'
    New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
    [IO.File]::WriteAllText($marker, 'chipmunks-android-build-v1')
    foreach ($file in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc')) {
        Copy-Item -LiteralPath (Join-Path $repo $file) -Destination (Join-Path $buildRoot $file)
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $buildRoot 'server') | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'server/package.json') -Destination (Join-Path $buildRoot 'server/package.json')
    foreach ($folder in @('client', 'patches')) {
        Sync-BuildSourceFolder -SourceRoot $repo -CacheRoot $buildRoot -Folder $folder
    }
    [IO.File]::WriteAllText((Join-Path $buildRoot 'client/android/local.properties'), "sdk.dir=$($sdk.Replace('\', '/'))`n")
    if ($SyncOnly) {
        Write-Host "SYNC PASSED: latest source synchronized to $buildRoot. No dependency installation or APK build started."
        exit 0
    }
    Set-Location -LiteralPath $buildRoot
    # Both Expo app.config and native BuildConfig read this process-local value.
    # Keep credentials outside source files and command-line arguments.
    $env:UPDATE_SERVER_URL = $releaseUpdateServer
    Write-Host '[2/5] Installing locked dependencies (cached packages are reused)...'
    # pnpm must also run without an interactive confirmation prompt.
    $env:CI = '1'
    Invoke-Checked $pnpm @('install', '--frozen-lockfile', '--ignore-scripts', '--node-linker=hoisted', '--prefer-offline')
    $env:NODE_ENV = 'production'
    $env:EXPO_NO_DOTENV = '1'
    $env:EXPO_NO_METRO_WORKSPACE_ROOT = '1'
    $env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
    $env:CHIPMUNKS_RELEASE_STORE_FILE = $signing.storeFile
    $env:CHIPMUNKS_RELEASE_STORE_PASSWORD = $signing.storePassword
    $env:CHIPMUNKS_RELEASE_KEY_ALIAS = $signing.keyAlias
    $env:CHIPMUNKS_RELEASE_KEY_PASSWORD = $signing.keyPassword
    if ($managedSigning) {
        $keytool = Join-Path $env:JAVA_HOME 'bin/keytool.exe'
        $aliasCheck = & $keytool -list -keystore $signing.storeFile -storepass:env CHIPMUNKS_RELEASE_STORE_PASSWORD -alias $signing.keyAlias 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'Managed signing key alias could not be verified. Open signing management and check the original key alias and password.' }
        $aliasCheck = $null
    }
    Write-Host '[3/5] Checking launch resources, NAS backup schema and building signed ARM64 APK...'
    Invoke-Checked $node @('client/scripts/check-android-launch.cjs')
    Invoke-Checked $node @('client/scripts/check-android-backup.cjs')
    $gradleArgs = @(':app:assembleRelease', '-PreactNativeArchitectures=arm64-v8a', '--max-workers=2', '--console=plain', '-Dorg.gradle.internal.http.connectionTimeout=20000', '-Dorg.gradle.internal.http.socketTimeout=30000')
    # Keep GUI cancellation inside its process job instead of reusing a CMD-owned daemon.
    if ($NonInteractive) { $gradleArgs += '--no-daemon' }
    $uri = [Uri]'https://dl.google.com'
    $proxy = [Net.WebRequest]::GetSystemWebProxy().GetProxy($uri)
    if ($proxy -and $proxy.Authority -ne $uri.Authority) {
        $gradleArgs += @("-Dhttps.proxyHost=$($proxy.Host)", "-Dhttps.proxyPort=$($proxy.Port)", "-Dhttp.proxyHost=$($proxy.Host)", "-Dhttp.proxyPort=$($proxy.Port)")
        Write-Host 'Using the existing system proxy for this build only.'
    }
    Set-Location -LiteralPath (Join-Path $buildRoot 'client/android')
    Invoke-Checked '.\gradlew.bat' $gradleArgs
    $apk = Join-Path $buildRoot 'client/android/app/build/outputs/apk/release/app-release.apk'
    if (-not (Test-Path -LiteralPath $apk)) { throw 'Gradle returned without producing app-release.apk.' }
    Write-Host '[4/5] Verifying APK signature, package, version and CPU architecture...'
    $signer = Join-Path $buildTools 'apksigner.bat'
    $signature = & $signer verify --verbose --print-certs $apk 2>&1
    if ($LASTEXITCODE -ne 0 -or ($signature -join "`n") -match 'CN=Android Debug') { throw 'APK release signature verification failed.' }
    $version = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $buildRoot 'client/version.json') | ConvertFrom-Json
    $badging = (& (Join-Path $buildTools 'aapt.exe') dump badging $apk) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $badging -notmatch "name='com.chipmunks.traceability'" -or
        $badging -notmatch ("versionCode='" + $version.versionCode + "'") -or
        $badging -notmatch ("versionName='" + [regex]::Escape($version.version) + "'") -or
        $badging -notmatch "(?m)^native-code: 'arm64-v8a'\s*$" -or $badging -match 'application-debuggable') {
        throw 'Unexpected APK package, version, architecture or debug mode.'
    }
    Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-c', '-P', '16', '4', $apk)
    # AAPT optimizes resource filenames, so resolve the launch drawable from the APK resource table.
    $resources = (& (Join-Path $buildTools 'aapt2.exe') dump resources $apk) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read the APK resource table.' }
    $launchBlock = [regex]::Match($resources, '(?m)^\s*resource [^\r\n]+ drawable/splashscreen_logo\r?\n(?:[ \t]+\([^\r\n]*\)[^\r\n]*\r?\n)+').Value
    $launchFiles = [regex]::Matches($launchBlock, '\(file\) (\S+) type=PNG')
    if ($launchFiles.Count -ne 10 -or $launchBlock -notmatch '\(night-' -or $launchBlock -match 'type=XML') {
        throw 'Expected five light and five dark branded launch images.'
    }
    $backgroundBlock = [regex]::Match($resources, '(?m)^\s*resource [^\r\n]+ color/splashscreen_background\r?\n(?:[ \t]+\([^\r\n]*\)[^\r\n]*\r?\n)+').Value
    if ($backgroundBlock -notmatch '#ffffffff' -or $backgroundBlock -notmatch '\(night\) #ff121212') {
        throw 'APK is missing the light/dark launch background colors.'
    }
    $themeBlock = [regex]::Match($resources, '(?ms)^\s*resource [^\r\n]+ style/Theme\.App\.SplashScreen\r?\n.*?(?=^\s*resource |\z)').Value
    if (-not $themeBlock -or $themeBlock -match '(android:windowBackground\(|0x01010054=)') {
        throw 'Launch theme overrides the Android 11 logo layer with a plain background.'
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($apk)
    try {
        $appConfigEntry = $zip.GetEntry('assets/app.config')
        if (-not $appConfigEntry) { throw 'APK is missing its Expo app configuration.' }
        $appConfigReader = New-Object IO.StreamReader($appConfigEntry.Open(), [Text.Encoding]::UTF8)
        try {
            try { $packagedAppConfig = $appConfigReader.ReadToEnd() | ConvertFrom-Json }
            catch { throw 'APK Expo configuration could not be parsed.' }
        } finally { $appConfigReader.Dispose() }
        if ($packagedAppConfig.extra.updateServerUrl -ne $releaseUpdateServer) {
            throw 'APK NAS authentication configuration is stale or missing. No APK will be delivered.'
        }
        $builtOta = Get-Content (Join-Path $buildRoot 'client/ota-runtime.json') -Raw | ConvertFrom-Json
        if ($packagedAppConfig.runtimeVersion -ne $builtOta.runtimeVersion -or -not $resources.Contains($builtOta.runtimeVersion)) {
            throw 'APK hot-update runtime verification failed. No APK will be delivered.'
        }
        $nativeNasConfigured = $false
        foreach ($dexEntry in $zip.Entries) {
            if ($dexEntry.FullName -notmatch '^classes\d*\.dex$') { continue }
            $dexStream = $dexEntry.Open()
            $dexBuffer = New-Object IO.MemoryStream
            try {
                $dexStream.CopyTo($dexBuffer)
                if ([Text.Encoding]::UTF8.GetString($dexBuffer.ToArray()).Contains($releaseUpdateServer)) {
                    $nativeNasConfigured = $true
                    break
                }
            } finally {
                $dexStream.Dispose()
                $dexBuffer.Dispose()
            }
        }
        if (-not $nativeNasConfigured) { throw 'APK native NAS authentication is stale or missing. No APK will be delivered.' }
        $bundleEntry = $zip.GetEntry('assets/index.android.bundle')
        if (-not $bundleEntry) { throw 'APK is missing its JavaScript bundle.' }
        $bundleStream = $bundleEntry.Open()
        $bundleBuffer = New-Object IO.MemoryStream
        try {
            $bundleStream.CopyTo($bundleBuffer)
            if (-not [Text.Encoding]::ASCII.GetString($bundleBuffer.ToArray()).Contains($version.version)) {
                throw 'APK JavaScript bundle is stale: current app version is missing.'
            }
        } finally {
            $bundleStream.Dispose()
            $bundleBuffer.Dispose()
        }
        foreach ($launchFile in $launchFiles) {
            if (-not $zip.GetEntry($launchFile.Groups[1].Value)) { throw 'APK is missing a branded launch resource.' }
        }
    } finally { $zip.Dispose() }
    Write-Host '[5/5] Saving verified APK...'
    $output = Join-Path $repo 'dist/apk'
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    $destination = Join-Path $output "$($version.appName)_$($version.version)_arm64_$stamp.apk"
    if (Test-Path -LiteralPath $destination) { throw 'Output APK already exists; refusing to overwrite it.' }
    Copy-Item -LiteralPath $apk -Destination $destination
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash
    [IO.File]::WriteAllText("$destination.sha256", "$hash  $([IO.Path]::GetFileName($destination))`n")
    [IO.File]::WriteAllText((Join-Path $output "$stamp-verification.txt"), "$badging`n$($signature -join "`n")`nSHA256=$hash`n")
    $otaBaseline = Get-Content (Join-Path $buildRoot 'client/ota-runtime.json') -Raw | ConvertFrom-Json
    $otaBaseline | Add-Member -NotePropertyName version -NotePropertyValue $version.version
    $otaBaseline | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $output 'ota-baseline.json')
    Write-Host "BUILD SUCCEEDED`nAPK: $destination`nSHA256: $hash`nLog: $logDir\$stamp.log" -ForegroundColor Green
} catch {
    Write-Host ("BUILD FAILED: " + (Protect-BuildOutput $_.Exception.Message)) -ForegroundColor Red
    if ($_.Exception.Message.Contains('[GUI:ATTENTION:SDK_LICENSE]')) { exit 2 }
    exit 1
} finally {
    if ($managedSigning -and $managedSigning.TemporaryDirectory) { Remove-ManagedSigningWork $managedSigning.TemporaryDirectory }
    foreach ($name in $releaseEnvironment.Keys) {
        $saved = $releaseEnvironment[$name]
        if ($saved.Exists) { [Environment]::SetEnvironmentVariable($name, $saved.Value, 'Process') }
        else { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    }
    if ($hadUpdateServerEnv) { $env:UPDATE_SERVER_URL = $previousUpdateServerEnv }
    else { Remove-Item -LiteralPath Env:UPDATE_SERVER_URL -ErrorAction SilentlyContinue }
    if ($hadCiEnv) { $env:CI = $previousCiEnv }
    else { Remove-Item -LiteralPath Env:CI -ErrorAction SilentlyContinue }
    if ($hadCorepackPromptEnv) { $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = $previousCorepackPromptEnv }
    else { Remove-Item -LiteralPath Env:COREPACK_ENABLE_DOWNLOAD_PROMPT -ErrorAction SilentlyContinue }
    $ProgressPreference = $previousProgressPreference
    if ($transcript) { Stop-Transcript | Out-Null }
    if ($lock) { $lock.Dispose() }
    Set-Location -LiteralPath $repo
}
