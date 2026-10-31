# Isolated GUI/script contract tests. No private configuration, download, install or APK build.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$sourceScript = Join-Path $PSScriptRoot 'build-android-release.ps1'
$library = Join-Path $PSScriptRoot 'build-environment.ps1'
$fixture = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('chipmunks-apk-bridge-' + [guid]::NewGuid().ToString('N')))).TrimEnd('\')
$passed = 0

function Assert-Bridge { param([bool]$Condition, [string]$Message) if (-not $Condition) { throw $Message } }
function Test-Bridge { param([string]$Name, [scriptblock]$Action) & $Action; $script:passed++; Write-Host "PASS: $Name" }
function Assert-BridgeThrows {
    param([scriptblock]$Action, [string]$Expected)
    $message = $null
    try { & $Action | Out-Null } catch { $message = $_.Exception.Message }
    Assert-Bridge ($message -and $message.Contains($Expected)) "Expected '$Expected'; received '$message'"
}
function New-BridgeProject {
    param([string]$Name, [string]$EnvironmentBody)
    $project = Join-Path $fixture $Name
    New-Item -ItemType Directory -Path (Join-Path $project 'scripts'),(Join-Path $project 'client/android'),(Join-Path $project 'server') -Force | Out-Null
    foreach ($file in @('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','client/package.json','server/package.json')) {
        [IO.File]::WriteAllText((Join-Path $project $file), '{}')
    }
    [IO.File]::Copy($sourceScript, (Join-Path $project 'scripts/build-android-release.ps1'))
    [IO.File]::WriteAllText((Join-Path $project 'scripts/build-environment.ps1'), $EnvironmentBody)
    return $project
}
function Invoke-BridgeChild {
    param([string]$Engine, [string]$Project, [string]$Arguments, [string]$GuiFlag = '')
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Engine
    $info.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $Project 'scripts/build-android-release.ps1') + '" ' + $Arguments
    $info.WorkingDirectory = $Project
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    $info.StandardOutputEncoding = [Text.Encoding]::UTF8
    $info.StandardErrorEncoding = [Text.Encoding]::UTF8
    if ($GuiFlag) { $info.EnvironmentVariables['CHIPMUNKS_APK_GUI'] = $GuiFlag }
    else { $info.EnvironmentVariables.Remove('CHIPMUNKS_APK_GUI') }
    $child = New-Object Diagnostics.Process
    $child.StartInfo = $info
    try {
        Assert-Bridge ($child.Start()) 'Fixture child did not start.'
        $child.StandardInput.Close()
        $stdout = $child.StandardOutput.ReadToEndAsync()
        $stderr = $child.StandardError.ReadToEndAsync()
        if (-not $child.WaitForExit(20000)) { $child.Kill(); throw 'Fixture child did not finish in 20 seconds.' }
        return [pscustomobject]@{ ExitCode = $child.ExitCode; Output = $stdout.Result + $stderr.Result }
    } finally { $child.Dispose() }
}

try {
    New-Item -ItemType Directory -Path $fixture | Out-Null
    Test-Bridge 'Build and environment scripts parse on the current PowerShell engine' {
        foreach ($path in @($sourceScript,$library)) {
            $tokens = $null; $errors = $null
            [Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors) | Out-Null
            Assert-Bridge ($errors.Count -eq 0) "Parse errors: $path"
        }
    }
    Test-Bridge 'CI is set before dependency installation and restored on exit' {
        $scriptText = [IO.File]::ReadAllText($sourceScript)
        Assert-Bridge ($scriptText.IndexOf('$env:CI = ''1''') -lt $scriptText.IndexOf("Invoke-Checked `$pnpm @('install'")) 'CI was set too late.'
        Assert-Bridge ($scriptText.Contains('if ($hadCiEnv) { $env:CI = $previousCiEnv }')) 'CI restoration is missing.'
        Assert-Bridge ($scriptText.Contains("if (`$NonInteractive) { `$gradleArgs += '--no-daemon' }")) 'GUI Gradle must not reuse a CMD-owned daemon.'
    }
    Test-Bridge 'GUI SDK preparation refuses before downloads or license execution' {
        . $library
        $sdkRoot = Join-Path $fixture 'sdk-missing'
        $oldSdk = $env:ANDROID_HOME
        try {
            $env:ANDROID_HOME = Join-Path $fixture 'missing-external-sdk'
            function Get-VerifiedBuildDownload { throw 'UNEXPECTED SDK DOWNLOAD' }
            Assert-BridgeThrows { Ensure-BuildSdk $sdkRoot -NonInteractive } '[GUI:ATTENTION:SDK_LICENSE]'
            Assert-Bridge (-not (Test-Path -LiteralPath $sdkRoot)) 'SDK refusal changed the fixture.'
        } finally { $env:ANDROID_HOME = $oldSdk }
    }
    Test-Bridge 'GUI environment flag propagates the same SDK attention marker' {
        . $library
        $oldGui = $env:CHIPMUNKS_APK_GUI; $oldSdk = $env:ANDROID_HOME
        try {
            $env:CHIPMUNKS_APK_GUI = '1'; $env:ANDROID_HOME = Join-Path $fixture 'missing-external-sdk'
            function Get-VerifiedBuildDownload { throw 'UNEXPECTED SDK DOWNLOAD' }
            Assert-BridgeThrows { Ensure-BuildSdk (Join-Path $fixture 'flag-sdk') } '[GUI:ATTENTION:SDK_LICENSE]'
        } finally { $env:CHIPMUNKS_APK_GUI = $oldGui; $env:ANDROID_HOME = $oldSdk }
    }
    Test-Bridge 'A complete existing SDK is reused in GUI mode without preparation' {
        . $library
        $sdkRoot = Join-Path $fixture 'complete-sdk'
        foreach ($file in @('platforms/android-36/android.jar','platform-tools/adb.exe','build-tools/36.0.0/aapt.exe','build-tools/36.0.0/aapt2.exe','build-tools/36.0.0/apksigner.bat','build-tools/36.0.0/zipalign.exe','licenses/android-sdk-license')) {
            $path = Join-Path $sdkRoot $file
            New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
            [IO.File]::WriteAllText($path,'fixture')
        }
        $oldSdk = $env:ANDROID_HOME
        try {
            $env:ANDROID_HOME = $sdkRoot
            function Get-VerifiedBuildDownload { throw 'UNEXPECTED SDK DOWNLOAD' }
            Assert-Bridge ((Ensure-BuildSdk (Join-Path $fixture 'unused') -NonInteractive) -eq $sdkRoot) 'Ready SDK was rejected.'
        } finally { $env:ANDROID_HOME = $oldSdk }
    }

    $engines = @((Get-Command powershell.exe).Source)
    $pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if ($pwsh) { $engines += $pwsh.Source }
    foreach ($engine in $engines) {
        $label = [IO.Path]::GetFileName($engine)
        Test-Bridge "$label legacy preparation retains its interactive script mode" {
            $project = New-BridgeProject ($label + '-legacy') @'
function Ensure-BuildEnvironment {
    param($Target,[switch]$CheckOnly,[switch]$NonInteractive)
    if ($NonInteractive -or $env:CHIPMUNKS_APK_GUI -eq '1') { throw 'Legacy preparation was forced into GUI mode.' }
    Write-Host 'FIXTURE:LEGACY_INTERACTIVE_MODE'
}
'@
            $result = Invoke-BridgeChild $engine $project '-PrepareOnly'
            Assert-Bridge ($result.ExitCode -eq 0 -and $result.Output.Contains('FIXTURE:LEGACY_INTERACTIVE_MODE')) $result.Output
        }
        Test-Bridge "$label hidden preparation holds the APK lock and receives noninteractive mode" {
            $project = New-BridgeProject ($label + '-prepare') @'
function Ensure-BuildEnvironment {
    param($Target,[switch]$CheckOnly,[switch]$NonInteractive)
    if (-not $NonInteractive) { throw 'NonInteractive was not passed.' }
    if ($env:COREPACK_ENABLE_DOWNLOAD_PROMPT -ne '0') { throw 'Corepack confirmation was not disabled.' }
    $probe = $null
    try { $probe = [IO.File]::Open((Join-Path (Split-Path $PSScriptRoot -Parent) 'logs/android-build/build.lock'),'Open','ReadWrite','None') }
    catch { Write-Host 'FIXTURE:LOCK_HELD' }
    if ($probe) { $probe.Dispose(); throw 'Build lock was not held during preparation.' }
}
'@
            $result = Invoke-BridgeChild $engine $project '-PrepareOnly -NonInteractive'
            Assert-Bridge ($result.ExitCode -eq 0 -and $result.Output.Contains('FIXTURE:LOCK_HELD') -and $result.Output.Contains('APK ENVIRONMENT READY')) $result.Output
            $lock = [IO.File]::Open((Join-Path $project 'logs/android-build/build.lock'),'Open','ReadWrite','None')
            $lock.Dispose()
        }
        Test-Bridge "$label returns exit 2 and readable SDK attention from a hidden child" {
            $project = New-BridgeProject ($label + '-attention') @'
function Ensure-BuildEnvironment {
    param($Target,[switch]$CheckOnly,[switch]$NonInteractive)
    if (-not $NonInteractive) { throw 'GUI environment flag was not passed.' }
    throw '[GUI:ATTENTION:SDK_LICENSE] Review licenses in a visible preparation window.'
}
'@
            $result = Invoke-BridgeChild $engine $project '-PrepareOnly' '1'
            Assert-Bridge ($result.ExitCode -eq 2 -and $result.Output.Contains('[GUI:ATTENTION:SDK_LICENSE]')) $result.Output
            $lock = [IO.File]::Open((Join-Path $project 'logs/android-build/build.lock'),'Open','ReadWrite','None')
            $lock.Dispose()
        }
        Test-Bridge "$label concurrent build is rejected before environment mutation" {
            $project = New-BridgeProject ($label + '-locked') 'function Ensure-BuildEnvironment { throw ''ENVIRONMENT MUST NOT BE REACHED'' }'
            New-Item -ItemType Directory -Path (Join-Path $project 'logs/android-build') -Force | Out-Null
            $lock = [IO.File]::Open((Join-Path $project 'logs/android-build/build.lock'),'OpenOrCreate','ReadWrite','None')
            try {
                $result = Invoke-BridgeChild $engine $project '-PrepareOnly -NonInteractive'
                Assert-Bridge ($result.ExitCode -eq 1 -and $result.Output.Contains('Another APK build is running') -and -not $result.Output.Contains('ENVIRONMENT MUST NOT BE REACHED')) $result.Output
            } finally { $lock.Dispose() }
        }
        Test-Bridge "$label CheckOnly reaches read-only checks without creating a log directory" {
            $project = New-BridgeProject ($label + '-readonly') @'
function Ensure-BuildEnvironment {
    param($Target,[switch]$CheckOnly,[switch]$NonInteractive)
    if (-not $CheckOnly) { throw 'CheckOnly was not passed.' }
    throw 'FIXTURE:READ_ONLY_CHECK_REACHED'
}
'@
            $result = Invoke-BridgeChild $engine $project '-CheckOnly -NonInteractive'
            Assert-Bridge ($result.ExitCode -eq 1 -and $result.Output.Contains('FIXTURE:READ_ONLY_CHECK_REACHED')) $result.Output
            Assert-Bridge (-not (Test-Path -LiteralPath (Join-Path $project 'logs'))) 'CheckOnly created logs.'
        }
        Test-Bridge "$label SyncOnly skips environment preparation and fails safely on missing fixture config" {
            $project = New-BridgeProject ($label + '-sync') 'function Ensure-BuildEnvironment { throw ''ENVIRONMENT MUST NOT BE REACHED'' }'
            $result = Invoke-BridgeChild $engine $project '-SyncOnly -NonInteractive'
            Assert-Bridge ($result.ExitCode -eq 1 -and $result.Output.Contains('Missing android-build.local') -and -not $result.Output.Contains('ENVIRONMENT MUST NOT BE REACHED')) $result.Output
        }
    }
    Write-Host "APK BRIDGE TESTS PASSED: $passed (PowerShell $($PSVersionTable.PSVersion)). No download, private configuration or APK build was used."
} finally {
    $cleanup = [IO.Path]::GetFullPath($fixture).TrimEnd('\')
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ($cleanup.StartsWith($temp + '\',[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($cleanup) -match '^chipmunks-apk-bridge-[0-9a-f]{32}$') {
        if (Test-Path -LiteralPath $cleanup) { Remove-Item -LiteralPath $cleanup -Recurse -Force }
    } else { throw 'Refusing cleanup outside the bridge test fixture.' }
}
