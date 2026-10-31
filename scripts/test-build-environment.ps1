# Isolated bootstrap regressions. No real downloads, installers, APK or EXE builds.
$ErrorActionPreference = 'Stop'
$library = Join-Path $PSScriptRoot 'build-environment.ps1'
$repoRoot = Split-Path $PSScriptRoot -Parent
$testRoot = Join-Path $repoRoot ('output/build-environment-bootstrap-20261014/test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$count = 0
function Assert-Test { param([bool]$Condition, [string]$Message) if (-not $Condition) { throw $Message } }
function Assert-Throws { param([scriptblock]$Run, [string]$Pattern)
    $caught = $null
    try { & $Run | Out-Null } catch { $caught = $_.Exception.Message }
    Assert-Test ($null -ne $caught -and $caught -match $Pattern) "Expected failure: $Pattern; actual: $caught"
}
function Run-Test { param([string]$Name, [scriptblock]$Run)
    $keys = @('PATH','JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','COREPACK_HOME','COREPACK_ENABLE_NETWORK','COREPACK_ENABLE_DOWNLOAD_PROMPT')
    $saved = @{}
    foreach ($key in $keys) { $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
    try { & $Run; $script:count++; Write-Host "PASS $Name" }
    finally { foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') } }
}

try {
    Run-Test 'Compatible environments skip all installation, including read-only mode' {
        . $library
        $root = Join-Path $testRoot 'read-only'
        function Get-CompatibleBuildNode { return 'C:\fixture\node.exe' }
        function Get-CompatibleBuildJdk { return 'C:\fixture\jdk17' }
        function Get-BuildCommandPath { return 'C:\fixture\pnpm.cmd' }
        function Invoke-BuildToolProbe { return '9.0.0' }
        function Ensure-BuildSdk { return 'C:\fixture\sdk36' }
        function Ensure-SyncBuildPython { return 'C:\fixture\python.exe' }
        function Initialize-BuildToolRoot { throw 'No preparation may run' }
        function Get-VerifiedBuildDownload { throw 'No network may run' }
        $result = Ensure-BuildEnvironment -Target Both -CheckOnly -ToolRoot $root
        Assert-Test ($result.python -eq 'C:\fixture\python.exe' -and $result.node -eq 'C:\fixture\node.exe') 'Compatible tools not reused'
        Assert-Test (-not (Test-Path -LiteralPath $root)) 'CheckOnly wrote a tool directory'
    }
    Run-Test 'Missing Node stops CheckOnly before downloading' {
        . $library
        function Get-CompatibleBuildNode { return $null }
        function Install-BuildNode { throw 'Installer must not run' }
        Assert-Throws { Ensure-BuildEnvironment -Target Apk -CheckOnly -ToolRoot (Join-Path $testRoot 'missing-node') } 'Missing compatible Node'
    }
    Run-Test 'Missing Node and JDK are prepared once and verified before reuse' {
        . $library
        $script:nodeReady = $false; $script:jdkReady = $false; $script:installs = 0
        function Get-CompatibleBuildNode { if ($script:nodeReady) { return 'C:\fixture\node.exe' }; return $null }
        function Install-BuildNode { $script:installs++; $script:nodeReady = $true; return 'C:\fixture\node.exe' }
        function Get-CompatibleBuildJdk { if ($script:jdkReady) { return 'C:\fixture\jdk17' }; return $null }
        function Install-BuildJdk { $script:installs++; $script:jdkReady = $true; return 'C:\fixture\jdk17' }
        function Get-BuildCommandPath { return 'C:\fixture\pnpm.cmd' }
        function Invoke-BuildToolProbe { return '9.0.0' }
        function Ensure-BuildSdk { return 'C:\fixture\sdk36' }
        $root = Join-Path $testRoot 'auto-fixture'
        Ensure-BuildEnvironment -Target Apk -ToolRoot $root | Out-Null
        Ensure-BuildEnvironment -Target Apk -ToolRoot $root | Out-Null
        Assert-Test ($script:installs -eq 2) 'Already prepared tools reinstalled'
    }
    Run-Test 'Broken preparation stops before SDK and releases the lock' {
        . $library
        function Get-CompatibleBuildNode { return $null }
        function Install-BuildNode { return 'C:\fixture\broken-node.exe' }
        function Ensure-BuildSdk { throw 'SDK must not be reached' }
        $root = Join-Path $testRoot 'broken-prepare-fixture'
        Assert-Throws { Ensure-BuildEnvironment -Target Apk -ToolRoot $root } 'Prepared Node.js could not be verified'
        $lock = [IO.File]::Open((Join-Path $root 'prepare.lock'), 'Open','ReadWrite','None')
        $lock.Dispose()
    }
    Run-Test 'Managed pnpm shim works in a Unicode path and reuses its cache' {
        . $library
        $root = Join-Path $testRoot ([string][char]0x5DE5 + [char]0x5177 + ' with spaces')
        $nodeDir = Join-Path $root 'node-fixture'
        New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $root '.chipmunks-build-tools'), 'chipmunks-build-tools-v1')
        [IO.File]::WriteAllText((Join-Path $nodeDir 'corepack.cmd'), "@echo off`r`nif `"%1`"==`"prepare`" (`r`n echo prepare>>`"%~dp0calls.txt`"`r`n exit /b 0`r`n)`r`necho 9.0.0`r`nexit /b 0`r`n", [Text.Encoding]::ASCII)
        function Get-CompatibleBuildNode { return (Join-Path $nodeDir 'node.exe') }
        function Get-CompatibleBuildJdk { return 'C:\fixture\jdk17' }
        function Get-BuildCommandPath { return $null }
        function Ensure-BuildSdk { return 'C:\fixture\sdk36' }
        $first = Ensure-BuildEnvironment -Target Apk -ToolRoot $root
        $second = Ensure-BuildEnvironment -Target Apk -ToolRoot $root
        Assert-Test ($first.pnpm -eq $second.pnpm) 'Prepared pnpm not reused'
        Assert-Test (@(Get-Content -LiteralPath (Join-Path $nodeDir 'calls.txt')).Count -eq 1) 'pnpm repeatedly prepared'
    }
    Run-Test 'Node version and sqlite capability determine reuse' {
        . $library
        function Get-BuildCommandPath { return 'C:\fixture\node.exe' }
        function Invoke-BuildToolProbe { return 'BUILD_NODE:20.19.0:x64' }
        Assert-Test (-not (Get-CompatibleBuildNode $testRoot)) 'Old Node accepted'
        function Invoke-BuildToolProbe { return 'BUILD_NODE:22.13.0:x64' }
        Assert-Test (-not (Get-CompatibleBuildNode $testRoot)) 'Unvalidated old Node accepted'
        function Invoke-BuildToolProbe { return 'BUILD_NODE:22.23.1:x86' }
        Assert-Test (-not (Get-CompatibleBuildNode $testRoot)) '32-bit Node accepted'
        function Invoke-BuildToolProbe { return 'BUILD_NODE:22.23.1:x64' }
        Assert-Test ((Get-CompatibleBuildNode $testRoot) -eq 'C:\fixture\node.exe') 'Compatible Node rejected'
        function Invoke-BuildToolProbe { return $null }
        Assert-Test (-not (Get-CompatibleBuildNode $testRoot)) 'Broken sqlite probe accepted'
    }
    Run-Test 'Missing Python or packages stops read-only checks without installing' {
        . $library
        function Get-CompatibleBuildPython { return $null }
        function Get-VerifiedBuildDownload { throw 'Installer must not run' }
        Assert-Throws { Ensure-SyncBuildPython $testRoot 'fixture.txt' -CheckOnly } 'Missing compatible Python'
        function Get-CompatibleBuildPython { return 'C:\fixture\python.exe' }
        function Test-SyncBuildTkRuntime { return $true }
        function Test-SyncBuildDependencies { return $false }
        Assert-Throws { Ensure-SyncBuildPython $testRoot 'fixture.txt' -CheckOnly } 'Missing/mismatched sync'
    }
    Run-Test 'Matching Python packages bypass pip and venv preparation' {
        . $library
        function Get-CompatibleBuildPython { return 'C:\fixture\python.exe' }
        function Test-SyncBuildTkRuntime { return $true }
        function Test-SyncBuildDependencies { return $true }
        function Get-VerifiedBuildDownload { throw 'Installer must not run' }
        Assert-Test ((Ensure-SyncBuildPython $testRoot 'fixture.txt') -eq 'C:\fixture\python.exe') 'Compatible Python rejected'
    }
    Run-Test 'Tk probe verifies the Tcl/Tk runtime and closes its hidden window' {
        . $library
        function Invoke-BuildToolProbe {
            param([string]$Program, [string[]]$Arguments)
            Assert-Test ($Arguments[1] -match 'import tkinter,tkinter.ttk' -and $Arguments[1] -match 'root.withdraw\(\)' -and
                $Arguments[1] -match "package','require','Tk" -and $Arguments[1] -match 'root.destroy\(\)') 'Tk probe did not verify runtime data or close its window'
            return 'BUILD_TK_OK'
        }
        Assert-Test (Test-SyncBuildTkRuntime 'C:\fixture\python.exe') 'Working Tcl/Tk runtime rejected'
        function Invoke-BuildToolProbe { return $null }
        Assert-Test (-not (Test-SyncBuildTkRuntime 'C:\fixture\python.exe')) 'Broken Tcl/Tk runtime accepted'
    }
    Run-Test 'Missing Tk stops read-only checks without preparing or downloading' {
        . $library
        function Get-CompatibleBuildPython { return 'C:\fixture\python.exe' }
        function Test-SyncBuildTkRuntime { return $false }
        function Get-VerifiedBuildDownload { throw 'No download may run' }
        function Start-Process { throw 'No installer may run' }
        function Assert-BuildToolChild { throw 'No tool preparation may run' }
        Assert-Throws { Ensure-SyncBuildPython $testRoot 'fixture.txt' -CheckOnly } 'Missing Tcl/Tk runtime'
    }
    Run-Test 'External Python without Tk is preserved and an existing managed runtime is reused' {
        . $library
        $root = Join-Path $testRoot 'reuse-tk-fixture'
        $expected = Join-Path $root 'python312/python.exe'
        function Get-CompatibleBuildPython { return 'C:\external\python.exe' }
        function Test-CompatibleBuildPythonPath { param([string]$Path) return ($Path -eq $expected) }
        function Test-SyncBuildTkRuntime { param([string]$Python) return ($Python -eq $expected) }
        function Test-SyncBuildDependencies { return $true }
        function Get-VerifiedBuildDownload { throw 'No download may run' }
        function Start-Process { throw 'External installation must not be changed' }
        Assert-Test ((Ensure-SyncBuildPython $root 'fixture.txt') -eq $expected) 'Managed Tk runtime not reused'
        function Test-CompatibleBuildPythonPath { return $false }
        Assert-Throws { Ensure-SyncBuildPython $root 'fixture.txt' } 'external Python installation has not been changed'
    }
    Run-Test 'Fresh and existing managed Python preparation both include Tcl/Tk' {
        foreach ($repair in @($false, $true)) {
            . $library
            $root = Join-Path $testRoot ('prepare-tk-fixture-' + $repair)
            $expected = Join-Path $root 'python312/python.exe'
            $script:tkReady = $false
            $script:installerCalls = 0
            function Get-CompatibleBuildPython { if ($repair) { return $expected }; return $null }
            function Test-CompatibleBuildPythonPath { param([string]$Path) return ($Path -eq $expected -and ($repair -or $script:tkReady)) }
            function Test-SyncBuildTkRuntime { return $script:tkReady }
            function Test-SyncBuildDependencies { return $true }
            function Get-VerifiedBuildDownload { return 'C:\fixture\python-installer.exe' }
            function Start-Process {
                param($FilePath, $ArgumentList, $WindowStyle, [switch]$Wait, [switch]$PassThru)
                $script:installerCalls++
                Assert-Test ($ArgumentList -contains 'Include_tcltk=1' -and $ArgumentList -notcontains 'Include_tcltk=0') 'Tcl/Tk excluded from installer'
                Assert-Test (($ArgumentList -contains '/modify') -eq $repair) 'Managed repair mode incorrect'
                Assert-Test ($WindowStyle -eq 'Hidden' -and $Wait -and $PassThru) 'Installer launch flags incorrect'
                $script:tkReady = $true
                return [pscustomobject]@{ ExitCode = 0 }
            }
            Assert-Test ((Ensure-SyncBuildPython $root 'fixture.txt') -eq $expected) 'Prepared Python not selected directly'
            Assert-Test ($script:installerCalls -eq 1) 'Installer should run only once'
        }
    }
    Run-Test 'SDK checks detect missing components and do not modify external SDKs' {
        . $library
        $sdk = Join-Path $testRoot 'sdk-fixture'
        foreach ($file in @('platforms/android-36/android.jar','platform-tools/adb.exe', 'build-tools/36.0.0/aapt.exe',
            'build-tools/36.0.0/aapt2.exe','build-tools/36.0.0/apksigner.bat','build-tools/36.0.0/zipalign.exe','licenses/android-sdk-license')) {
            $path = Join-Path $sdk $file
            New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
            [IO.File]::WriteAllText($path, 'fixture')
        }
        $env:ANDROID_HOME = $sdk
        Assert-Test (@(Get-BuildSdkMissing $sdk).Count -eq 0) 'Complete SDK rejected'
        Assert-Test ((Ensure-BuildSdk $testRoot -CheckOnly) -eq $sdk) 'Existing SDK not reused'
        Remove-Item -LiteralPath (Join-Path $sdk 'build-tools/36.0.0/aapt2.exe')
        Assert-Test (@(Get-BuildSdkMissing $sdk).Count -eq 1) 'Missing SDK component undetected'
        function Get-VerifiedBuildDownload { throw 'No network may run' }
        Assert-Throws { Ensure-BuildSdk $testRoot -CheckOnly } 'Missing Android SDK'
    }
    Run-Test 'Declined SDK licenses stop before package installation' {
        . $library
        $root = Initialize-BuildToolRoot (Join-Path $testRoot 'license-fixture')
        $manager = Join-Path $root 'android-sdk/cmdline-tools/latest/bin/sdkmanager.bat'
        New-Item -ItemType Directory -Path (Split-Path $manager -Parent) -Force | Out-Null
        [IO.File]::WriteAllText($manager, "@echo off`r`nexit /b 1`r`n", [Text.Encoding]::ASCII)
        $env:ANDROID_HOME = Join-Path $testRoot 'missing-external-sdk'
        function Get-VerifiedBuildDownload { throw 'No download should run' }
        Assert-Throws { Ensure-BuildSdk $root } 'SDK licenses were not accepted'
        Assert-Test (-not (Test-Path -LiteralPath (Join-Path $root 'android-sdk/platforms'))) 'Packages installed despite rejection'
    }
    Run-Test 'Download checksum cache, retry failures and source validation' {
        . $library
        $root = Initialize-BuildToolRoot (Join-Path $testRoot 'download-fixture')
        $content = Join-Path $testRoot 'expected.txt'
        [IO.File]::WriteAllText($content, 'verified-data')
        $hash = (Get-FileHash -LiteralPath $content -Algorithm SHA256).Hash
        $script:requests = 0
        function Invoke-WebRequest {
            [CmdletBinding()]param([string]$Uri,[string]$OutFile,[switch]$UseBasicParsing,[int]$TimeoutSec)
            $script:requests++
            [IO.File]::WriteAllText($OutFile, 'verified-data')
        }
        $first = Get-VerifiedBuildDownload $root 'https://nodejs.org/fixture.zip' 'fixture.zip' $hash
        $second = Get-VerifiedBuildDownload $root 'https://nodejs.org/fixture.zip' 'fixture.zip' $hash
        Assert-Test ($first -eq $second -and $script:requests -eq 1) 'Verified cache redownloaded'
        Assert-Throws { Get-VerifiedBuildDownload $root 'https://untrusted.example/fixture.zip' 'fixture.zip' $hash } 'Untrusted'
        Assert-Throws { Get-VerifiedBuildDownload $root 'https://nodejs.org/fixture.zip' '../escape.zip' $hash } 'Invalid download'
        Assert-Throws { Get-VerifiedBuildDownload $root 'https://nodejs.org/fixture.zip' 'bad.zip' 'invalid' } 'Invalid tool download checksum'
        Assert-Throws { Get-VerifiedBuildDownload $root 'https://nodejs.org/fixture.zip' 'broken.zip' ('0' * 64) } 'Cannot download/verify'
        Assert-Test ($script:requests -eq 4) 'Retries were not bounded'
        Assert-Test (-not (Test-Path -LiteralPath (Join-Path $root 'downloads/broken.zip'))) 'Unverified download promoted to cache'
        Assert-Test (@(Get-ChildItem -LiteralPath (Join-Path $root 'downloads') -Filter '*.part').Count -eq 0) 'Partial downloads left behind'
    }
    Run-Test 'Unowned roots and escaping archive paths are rejected' {
        . $library
        Assert-Throws { Initialize-BuildToolRoot $testRoot } 'not owned'
        Assert-Throws { Assert-BuildToolChild $testRoot (Join-Path $testRoot '../escape') } 'Unsafe'
        $root = Initialize-BuildToolRoot (Join-Path $testRoot 'archive-fixture')
        $archive = Join-Path $root 'unsafe.zip'
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::Open($archive, 'Create')
        try { $zip.CreateEntry('../escape.txt') | Out-Null } finally { $zip.Dispose() }
        Assert-Throws { Expand-BuildToolArchive $root $archive (Join-Path $root 'unpack') } 'Unsafe'
        Assert-Test (-not (Test-Path -LiteralPath (Join-Path $root 'escape.txt'))) 'ZIP wrote outside destination'
    }
    Run-Test 'Owned cache cleanup refuses junction children and preserves their target' {
        . $library
        $root = Initialize-BuildToolRoot (Join-Path $testRoot 'cleanup-fixture')
        $target = Join-Path $root 'broken-venv'
        $keep = Join-Path $testRoot 'keep-outside-tools'
        New-Item -ItemType Directory -Path $target,$keep -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $keep 'keep.txt'), 'must survive')
        $junction = Join-Path $target 'redirected'
        New-Item -ItemType Junction -Path $junction -Target $keep | Out-Null
        try {
            Assert-Throws { Remove-OwnedBuildToolDirectory $root $target } 'redirected child'
            Assert-Test (Test-Path -LiteralPath (Join-Path $keep 'keep.txt')) 'Junction target deleted'
        } finally { [IO.Directory]::Delete($junction) }
        Remove-OwnedBuildToolDirectory $root $target
        Assert-Test (-not (Test-Path -LiteralPath $target)) 'Owned temporary cache not removed'
    }
    Run-Test 'Preparation lock blocks concurrent mutation and is reusable afterward' {
        . $library
        $root = Initialize-BuildToolRoot (Join-Path $testRoot 'locked-fixture')
        $lock = [IO.File]::Open((Join-Path $root 'prepare.lock'), 'OpenOrCreate','ReadWrite','None')
        try { Assert-Throws { Ensure-BuildEnvironment -Target Sync -ToolRoot $root } 'Another build environment preparation' }
        finally { $lock.Dispose() }
        function Ensure-SyncBuildPython { return 'C:\fixture\python.exe' }
        $requirements = Join-Path $testRoot 'fixture-requirements.txt'
        [IO.File]::WriteAllText($requirements, '# fixture')
        $result = Ensure-BuildEnvironment -Target Sync -ToolRoot $root -RequirementsFile $requirements
        Assert-Test ($result.python -eq 'C:\fixture\python.exe') 'Lock not released'
    }
    Write-Host "BOOTSTRAP TESTS PASSED: $count" -ForegroundColor Green
} finally {
    $absoluteRoot = [IO.Path]::GetFullPath($testRoot)
    $intendedParent = [IO.Path]::GetFullPath((Join-Path $repoRoot 'output/build-environment-bootstrap-20261014')).TrimEnd('\')
    if ($absoluteRoot.StartsWith($intendedParent + '\', [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($absoluteRoot) -match '^test-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $absoluteRoot -Recurse -Force
    }
}
