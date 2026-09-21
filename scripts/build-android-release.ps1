param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path $PSScriptRoot -Parent
$lock = $null
$transcript = $false

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    Get-Command $Program -ErrorAction Stop | Out-Null
    $global:LASTEXITCODE = 0
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Program @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    if ($code -ne 0) { throw "$Program failed (exit $code). See the build log." }
}

try {
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
    $pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) {
        throw 'JAVA_HOME is missing or invalid. Install/configure JDK 17 first.'
    }
    $sdk = $env:ANDROID_HOME
    if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
    if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
    $buildTools = Join-Path $sdk 'build-tools/36.0.0'
    foreach ($tool in @('aapt.exe', 'aapt2.exe', 'apksigner.bat', 'zipalign.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $buildTools $tool))) { throw "Missing Android SDK tool: $tool" }
    }
    try { $signing = Get-Content -Raw -Encoding UTF8 -LiteralPath $config.signingFile | ConvertFrom-Json }
    catch { throw 'Cannot read the private signing configuration. Restore the signing folder first.' }
    foreach ($field in @('storeFile', 'storePassword', 'keyAlias', 'keyPassword')) {
        if ([string]::IsNullOrWhiteSpace($signing.$field)) { throw "Missing signing field: $field" }
    }
    if (-not (Test-Path -LiteralPath $signing.storeFile)) { throw 'Release keystore was not found.' }
    if ($CheckOnly) {
        Write-Host "CHECK PASSED: ARM64 release; cache=$buildRoot; local signing available. No build started."
        exit 0
    }

    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $logDir = Join-Path $repo 'logs/android-build'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    try { $lock = [IO.File]::Open((Join-Path $logDir 'build.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Another APK build is running. Do not start a second build.' }
    Start-Transcript -Path (Join-Path $logDir "$stamp.log") | Out-Null
    $transcript = $true
    Write-Host '[1/5] Synchronizing latest source into the dedicated build cache...'
    New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
    [IO.File]::WriteAllText($marker, 'chipmunks-android-build-v1')
    foreach ($file in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc')) {
        Copy-Item -LiteralPath (Join-Path $repo $file) -Destination (Join-Path $buildRoot $file)
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $buildRoot 'server') | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'server/package.json') -Destination (Join-Path $buildRoot 'server/package.json')
    foreach ($folder in @('client', 'patches')) {
        $target = [IO.Path]::GetFullPath((Join-Path $buildRoot $folder))
        if (-not $target.StartsWith($buildRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe mirror target.' }
        & robocopy.exe (Join-Path $repo $folder) $target /MIR /XJ /XD node_modules build .cxx .gradle .expo .git /XF .env .env.* *.log *.tsbuildinfo local.properties /NFL /NDL /NJH /NJS /NP
        if ($LASTEXITCODE -ge 8) { throw "Source synchronization failed: $folder" }
    }
    [IO.File]::WriteAllText((Join-Path $buildRoot 'client/android/local.properties'), "sdk.dir=$($sdk.Replace('\', '/'))`n")
    Set-Location -LiteralPath $buildRoot
    Write-Host '[2/5] Installing locked dependencies (cached packages are reused)...'
    Invoke-Checked $pnpm @('install', '--frozen-lockfile', '--ignore-scripts', '--node-linker=hoisted', '--prefer-offline')
    $env:NODE_ENV = 'production'
    $env:EXPO_NO_DOTENV = '1'
    $env:EXPO_NO_METRO_WORKSPACE_ROOT = '1'
    $env:CI = '1'
    $env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
    $env:CHIPMUNKS_RELEASE_STORE_FILE = $signing.storeFile
    $env:CHIPMUNKS_RELEASE_STORE_PASSWORD = $signing.storePassword
    $env:CHIPMUNKS_RELEASE_KEY_ALIAS = $signing.keyAlias
    $env:CHIPMUNKS_RELEASE_KEY_PASSWORD = $signing.keyPassword
    Write-Host '[3/5] Checking launch resources, NAS backup schema and building signed ARM64 APK...'
    Invoke-Checked $node @('client/scripts/check-android-launch.cjs')
    Invoke-Checked $node @('client/scripts/check-android-backup.cjs')
    $gradleArgs = @(':app:assembleRelease', '-PreactNativeArchitectures=arm64-v8a', '--max-workers=2', '--console=plain', '-Dorg.gradle.internal.http.connectionTimeout=20000', '-Dorg.gradle.internal.http.socketTimeout=30000')
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
    Write-Host "BUILD SUCCEEDED`nAPK: $destination`nSHA256: $hash`nLog: $logDir\$stamp.log" -ForegroundColor Green
} catch {
    Write-Host "BUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($transcript) { Stop-Transcript | Out-Null }
    if ($lock) { $lock.Dispose() }
    Set-Location -LiteralPath $repo
}
