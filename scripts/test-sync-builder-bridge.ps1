# Isolated packaging contract tests. No real Python, PyInstaller, helper startup or private config.
param([string]$ResultPath)
$ErrorActionPreference = 'Stop'
$sourceScript = Join-Path $PSScriptRoot 'build.ps1'
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('chipmunks-sync-bridge-' + [guid]::NewGuid().ToString('N')))).TrimEnd('\')
$engine = (Get-Process -Id $PID).Path
$tests = New-Object Collections.Generic.List[object]
$activeChildren = New-Object Collections.Generic.List[Diagnostics.Process]
$utf8 = [Text.UTF8Encoding]::new($true)
$appName = '掌上仓库ERP版同步助手'

function Assert-SyncTest { param([bool]$Condition, [string]$Message) if (-not $Condition) { throw $Message } }
function Test-SyncBridge {
    param([string]$Name, [scriptblock]$Action)
    & $Action
    $tests.Add([pscustomobject]@{ name = $Name; passed = $true })
    Write-Host "PASS: $Name"
}
function Get-TestHash {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path); $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}
function New-SyncFixture {
    param([string]$Name)
    $project = Join-Path $fixtureRoot $Name
    [IO.Directory]::CreateDirectory((Join-Path $project 'scripts/assets')) | Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $project 'scripts/dist')) | Out-Null
    [IO.File]::Copy($sourceScript, (Join-Path $project 'scripts/build.ps1'))
    [IO.File]::WriteAllText((Join-Path $project 'scripts/label_sync_server.py'), "SYNC_VERSION = 'V1.0'`r`n", $utf8)
    [IO.File]::WriteAllText((Join-Path $project "scripts/dist/$appName.exe"), 'previous verified helper - never run', $utf8)
    foreach ($asset in @('geehy-logo.png','boya-logo.png','pb-logo.png','union-logo.png','esd-warning.png','keep-dry.png','wch-logo.png','dongwei-logo.png','rongpai-logo.png','linearin-logo.png')) {
        [IO.File]::WriteAllText((Join-Path $project "scripts/assets/$asset"), 'fixture')
    }
    $environment = @'
function Ensure-BuildEnvironment {
    param([string]$Target,[switch]$CheckOnly,[switch]$NonInteractive)
    if ($Target -ne 'Sync') { throw 'Wrong target.' }
    Write-Host "FIXTURE_ENV: CheckOnly=$CheckOnly; NonInteractive=$NonInteractive"
    if (-not $CheckOnly) { [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'environment-called.txt'),'fixture') }
    if ($env:SYNC_TEST_MODE -eq 'environment-failure') { throw 'Fixture environment unavailable.' }
    return [pscustomobject]@{ python = (Join-Path $PSScriptRoot 'fake-python.ps1') }
}
'@
    [IO.File]::WriteAllText((Join-Path $project 'scripts/build-environment.ps1'), $environment, $utf8)
    $fakePython = @'
if ($env:PYTHONUTF8 -ne '1' -or $env:PYTHONIOENCODING -ne 'utf-8') { throw 'Python UTF-8 process environment was not configured.' }
Write-Output 'UTF8 FIXTURE: 中文路径正常'
if ($env:SYNC_TEST_REAL_PYTHON) {
    & $env:SYNC_TEST_REAL_PYTHON -c "import os,sys; assert os.environ['PYTHONUTF8']=='1'; assert os.environ['PYTHONIOENCODING']=='utf-8'; assert sys.stdout.encoding.lower()=='utf-8'; print('\u4e2d\u6587\u8def\u5f84\u6b63\u5e38')"
    if ($LASTEXITCODE -ne 0) { throw 'Native Python UTF-8 probe failed.' }
}
$arguments = @($args)
$distIndex = [Array]::IndexOf($arguments, '--distpath')
$nameIndex = [Array]::IndexOf($arguments, '--name')
if ($arguments.Count -lt 4 -or $arguments[0] -ne '-m' -or $arguments[1] -ne 'PyInstaller' -or $distIndex -lt 0 -or $nameIndex -lt 0) { throw 'Wrong PyInstaller arguments.' }
$dist = $arguments[$distIndex + 1]
$name = $arguments[$nameIndex + 1]
[IO.Directory]::CreateDirectory($dist) | Out-Null
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'python-started.txt'), $dist)
if ($env:SYNC_TEST_MODE -eq 'cancel') { Start-Sleep -Seconds 40 }
if ($env:SYNC_TEST_MODE -eq 'missing') { $global:LASTEXITCODE = 0; return }
$bytes = New-Object byte[] 256
$bytes[0] = 0x4d; $bytes[1] = 0x5a
$bytes[60] = 128; $bytes[128] = 0x50; $bytes[129] = 0x45
$bytes[200] = 65
if ($env:SYNC_TEST_MODE -eq 'alternate') { $bytes[200] = 66 }
if ($env:SYNC_TEST_MODE -eq 'invalid-mz') { $bytes[0] = 0 }
if ($env:SYNC_TEST_MODE -eq 'invalid-pe') { $bytes[128] = 0 }
if ($env:SYNC_TEST_MODE -eq 'invalid-offset') { $bytes[60] = 255; $bytes[61] = 255 }
if ($env:SYNC_TEST_MODE -eq 'empty') { $bytes = New-Object byte[] 0 }
[IO.File]::WriteAllBytes((Join-Path $dist ($name + '.exe')), $bytes)
$global:LASTEXITCODE = 0
if ($env:SYNC_TEST_MODE -eq 'failure') { $global:LASTEXITCODE = 9 }
'@
    [IO.File]::WriteAllText((Join-Path $project 'scripts/fake-python.ps1'), $fakePython, $utf8)
    $restoreWrapper = @'
$hadUtf8 = Test-Path Env:PYTHONUTF8; $beforeUtf8 = $env:PYTHONUTF8
$hadIo = Test-Path Env:PYTHONIOENCODING; $beforeIo = $env:PYTHONIOENCODING
& (Join-Path $PSScriptRoot 'build.ps1')
$code = $LASTEXITCODE
if ((Test-Path Env:PYTHONUTF8) -ne $hadUtf8 -or $env:PYTHONUTF8 -ne $beforeUtf8 -or
    (Test-Path Env:PYTHONIOENCODING) -ne $hadIo -or $env:PYTHONIOENCODING -ne $beforeIo) {
    throw 'Build script did not restore its caller Python environment.'
}
Write-Output 'PYTHON ENVIRONMENT RESTORED'
exit $code
'@
    [IO.File]::WriteAllText((Join-Path $project 'scripts/restore-probe.ps1'), $restoreWrapper, $utf8)
    return $project
}
function Start-SyncFixture {
    param([string]$Project, [string]$Arguments = '', [string]$Mode = '', [string]$GuiVariable = 'CHIPMUNKS_BUILD_GUI', [string]$BuildId = '0123456789abcdef0123456789abcdef')
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $engine
    $entry = 'scripts/build.ps1'
    if ($Mode -in @('restore-set','restore-unset')) { $entry = 'scripts/restore-probe.ps1' }
    $info.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $Project $entry) + '" ' + $Arguments
    $info.WorkingDirectory = $Project; $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true; $info.RedirectStandardInput = $true
    $info.StandardOutputEncoding = [Text.Encoding]::UTF8; $info.StandardErrorEncoding = [Text.Encoding]::UTF8
    $info.EnvironmentVariables['SYNC_TEST_MODE'] = $Mode
    $info.EnvironmentVariables.Remove('CHIPMUNKS_BUILD_TASK_ID')
    if ($BuildId) { $info.EnvironmentVariables['CHIPMUNKS_BUILD_TASK_ID'] = $BuildId }
    $info.EnvironmentVariables.Remove('SYNC_TEST_REAL_PYTHON')
    if ($Mode -eq 'restore-set') { $info.EnvironmentVariables['PYTHONUTF8'] = '0'; $info.EnvironmentVariables['PYTHONIOENCODING'] = 'latin-1' }
    if ($Mode -eq 'restore-unset') { $info.EnvironmentVariables.Remove('PYTHONUTF8'); $info.EnvironmentVariables.Remove('PYTHONIOENCODING') }
    if ($Mode -eq 'encoding-native') { $info.EnvironmentVariables['SYNC_TEST_REAL_PYTHON'] = (Get-Command python.exe -ErrorAction Stop).Source }
    $info.EnvironmentVariables.Remove('CHIPMUNKS_BUILD_GUI'); $info.EnvironmentVariables.Remove('CHIPMUNKS_APK_GUI')
    if ($GuiVariable) { $info.EnvironmentVariables[$GuiVariable] = '1' }
    $child = New-Object Diagnostics.Process; $child.StartInfo = $info
    Assert-SyncTest ($child.Start()) 'Fixture process did not start.'
    $activeChildren.Add($child); $child.StandardInput.Close()
    return [pscustomobject]@{ child = $child; stdout = $child.StandardOutput.ReadToEndAsync(); stderr = $child.StandardError.ReadToEndAsync() }
}
function Finish-SyncFixture {
    param($Running)
    if (-not $Running.child.WaitForExit(25000)) { $Running.child.Kill(); throw 'Fixture process exceeded 25 seconds.' }
    $Running.child.WaitForExit()
    return [pscustomobject]@{ exitCode = $Running.child.ExitCode; output = $Running.stdout.Result + $Running.stderr.Result }
}
function Invoke-SyncFixture {
    param([string]$Project, [string]$Arguments = '', [string]$Mode = '', [string]$GuiVariable = 'CHIPMUNKS_BUILD_GUI', [string]$BuildId = '0123456789abcdef0123456789abcdef')
    return Finish-SyncFixture (Start-SyncFixture $Project $Arguments $Mode $GuiVariable $BuildId)
}
function Get-Delivery {
    param($Result)
    $match = [regex]::Match($Result.output, '(?m)^EXE: (.+)\r?$')
    Assert-SyncTest $match.Success ('Missing EXE marker: ' + $Result.output)
    return $match.Groups[1].Value.Trim()
}
function Assert-OldPreserved {
    param([string]$Project, [string]$OldHash)
    Assert-SyncTest ((Get-TestHash (Join-Path $Project "scripts/dist/$appName.exe")) -eq $OldHash) 'Previous helper was modified.'
    Assert-SyncTest (@(Get-ChildItem -LiteralPath (Join-Path $Project 'scripts/dist') -File).Count -eq 1) 'Failed build published delivery artifacts.'
}
function Assert-SingleDelivery {
    param([string]$Project, [string]$Delivery)
    $expected = Join-Path $Project "scripts/dist/$appName.exe"
    Assert-SyncTest ([string]::Equals($Delivery, $expected, [StringComparison]::OrdinalIgnoreCase)) 'Delivery did not use the single fixed EXE path.'
    $files = @(Get-ChildItem -LiteralPath (Join-Path $Project 'scripts/dist') -File)
    Assert-SyncTest (@($files | Where-Object { $_.Extension -eq '.exe' }).Count -eq 1 -and $files.Count -eq 3) 'Successful build left duplicate EXEs or publication staging files.'
    Assert-SyncTest ([IO.File]::Exists($Delivery + '.sha256') -and [IO.File]::Exists($Delivery + '.verification.json')) 'Single delivery is missing verification sidecars.'
}

try {
    [IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
    [IO.File]::WriteAllText((Join-Path $fixtureRoot '.sync-fixture-owner'),'isolated')
    Test-SyncBridge 'Build script parses on this PowerShell engine' {
        $tokens = $null; $errors = $null
        [Management.Automation.Language.Parser]::ParseFile($sourceScript,[ref]$tokens,[ref]$errors) | Out-Null
        Assert-SyncTest ($errors.Count -eq 0) 'Build script parse error.'
    }
    Test-SyncBridge 'Check-only uses precise marker and changes no fixture files' {
        $p = New-SyncFixture 'check'
        $before = @(Get-ChildItem -LiteralPath $p -File -Recurse | ForEach-Object { $_.FullName + ':' + (Get-TestHash $_.FullName) }) -join "`n"
        $r = Invoke-SyncFixture $p '-CheckOnly'
        Assert-SyncTest ($r.exitCode -eq 0 -and $r.output.Contains('CHECK PASSED: Sync build environment ready.')) $r.output
        $after = @(Get-ChildItem -LiteralPath $p -File -Recurse | ForEach-Object { $_.FullName + ':' + (Get-TestHash $_.FullName) }) -join "`n"
        Assert-SyncTest ($before -eq $after -and -not [IO.Directory]::Exists((Join-Path $p 'logs'))) 'Read-only check wrote files.'
    }
    Test-SyncBridge 'Prepare-only runs environment preparation without packaging' {
        $p = New-SyncFixture 'prepare'; $r = Invoke-SyncFixture $p '-PrepareOnly'
        Assert-SyncTest ($r.exitCode -eq 0 -and $r.output.Contains('SYNC ENVIRONMENT READY. No EXE build started.')) $r.output
        Assert-SyncTest (-not [IO.File]::Exists((Join-Path $p 'scripts/python-started.txt'))) 'Prepare launched packaging.'
        Assert-SyncTest ([IO.File]::Exists((Join-Path $p 'scripts/environment-called.txt'))) 'Prepare skipped environment.'
    }
    Test-SyncBridge 'Both old and unified GUI flags enable noninteractive preparation' {
        foreach ($flag in @('CHIPMUNKS_BUILD_GUI','CHIPMUNKS_APK_GUI')) {
            $p = New-SyncFixture $flag; $r = Invoke-SyncFixture $p '-CheckOnly' '' $flag
            Assert-SyncTest ($r.exitCode -eq 0 -and $r.output.Contains('NonInteractive=True')) $r.output
        }
    }
    Test-SyncBridge 'Repeated builds publish one fixed EXE with current task, PE, hash and version verification' {
        $p = New-SyncFixture 'success'; $sourceHash = Get-TestHash (Join-Path $p 'scripts/label_sync_server.py')
        $r = Invoke-SyncFixture $p; Assert-SyncTest ($r.exitCode -eq 0 -and $r.output.Contains('BUILD SUCCEEDED')) $r.output
        $delivery = Get-Delivery $r; Assert-SyncTest ([IO.Path]::IsPathRooted($delivery) -and [IO.File]::Exists($delivery)) 'Delivery path invalid.'
        Assert-SingleDelivery $p $delivery
        $verification = [IO.File]::ReadAllText($delivery + '.verification.json') | ConvertFrom-Json
        Assert-SyncTest ($verification.version -eq 'V1.0' -and $verification.peHeaderVerified -and $verification.length -eq 256) 'Bad verification record.'
        Assert-SyncTest ($verification.buildId -eq '0123456789abcdef0123456789abcdef' -and $r.output.Contains('EXE-BUILD-ID: ' + $verification.buildId)) 'Verification did not bind output to this build task.'
        Assert-SyncTest ($verification.file -eq "$appName.exe") 'Verification retained a timestamped filename.'
        $hash = Get-TestHash $delivery
        Assert-SyncTest ($verification.sha256 -eq $hash -and [IO.File]::ReadAllText($delivery + '.sha256').StartsWith($hash)) 'Hash verification mismatch.'
        Assert-SyncTest ($r.output.Contains('SHA256: ' + $hash)) 'Build output hash marker did not match the published EXE.'
        Assert-SyncTest ((Get-TestHash (Join-Path $p "scripts/dist/$appName.exe")) -eq $hash) ('Standard publication differs: ' + $r.output)
        Assert-SyncTest ((Get-TestHash (Join-Path $p 'scripts/label_sync_server.py')) -eq $sourceHash) 'Sync source/version changed.'
        Assert-SyncTest (@(Get-ChildItem -LiteralPath (Join-Path $p 'scripts/.sync-build-temp') -Force).Count -eq 0) 'Owned temporary run was not cleaned.'
        foreach ($stage in 1..4) { Assert-SyncTest ($r.output.Contains("[$stage/4]")) 'Missing build stage.' }
        Start-Sleep -Milliseconds 10
        $r2 = Invoke-SyncFixture $p '' 'alternate' 'CHIPMUNKS_BUILD_GUI' 'fedcba9876543210fedcba9876543210'; $second = Get-Delivery $r2
        Assert-SyncTest ($r2.exitCode -eq 0 -and $second -eq $delivery) 'Second build changed the fixed delivery path.'
        Assert-SingleDelivery $p $second
        Assert-SyncTest ((Get-TestHash $second) -ne $hash) 'Second build reused stale output.'
        $secondVerification = [IO.File]::ReadAllText($second + '.verification.json') | ConvertFrom-Json
        Assert-SyncTest ($secondVerification.buildId -eq 'fedcba9876543210fedcba9876543210' -and $secondVerification.sha256 -eq (Get-TestHash $second)) 'Second build retained stale task verification.'
    }
    Test-SyncBridge 'Packaging nonzero exit preserves old EXE and publishes no delivery' {
        $p = New-SyncFixture 'py-failure'; $old = Get-TestHash (Join-Path $p "scripts/dist/$appName.exe")
        $r = Invoke-SyncFixture $p '' 'failure'
        Assert-SyncTest ($r.exitCode -ne 0 -and $r.output.Contains('exit 9') -and -not $r.output.Contains('BUILD SUCCEEDED')) $r.output
        Assert-OldPreserved $p $old
    }
    Test-SyncBridge 'Missing, empty and invalid PE outputs are rejected before publication' {
        foreach ($mode in @('missing','empty','invalid-mz','invalid-pe','invalid-offset')) {
            $p = New-SyncFixture $mode; $old = Get-TestHash (Join-Path $p "scripts/dist/$appName.exe")
            $r = Invoke-SyncFixture $p '' $mode
            Assert-SyncTest ($r.exitCode -ne 0 -and -not $r.output.Contains('BUILD SUCCEEDED')) ($mode + ': ' + $r.output)
            Assert-OldPreserved $p $old
        }
    }
    Test-SyncBridge 'Locked EXE fails clearly, preserves previous EXE and creates no alternate delivery' {
        $p = New-SyncFixture 'locked-standard'; $standard = Join-Path $p "scripts/dist/$appName.exe"
        $old = Get-TestHash $standard; $held = [IO.File]::Open($standard, 'Open', 'Read', 'Read')
        try { $r = Invoke-SyncFixture $p }
        finally { $held.Dispose() }
        Assert-SyncTest ($r.exitCode -ne 0 -and $r.output.Contains('BUILD FAILED') -and -not $r.output.Contains('BUILD SUCCEEDED') -and -not [regex]::IsMatch($r.output, '(?m)^EXE: ')) $r.output
        Assert-OldPreserved $p $old
        $retry = Invoke-SyncFixture $p
        Assert-SyncTest ($retry.exitCode -eq 0) $retry.output
        Assert-SingleDelivery $p (Get-Delivery $retry)
    }
    Test-SyncBridge 'Shared lock rejects build and preparation before either writes environment state' {
        $p = New-SyncFixture 'build-lock'; $logs = Join-Path $p 'logs/sync-build'; [IO.Directory]::CreateDirectory($logs) | Out-Null
        $held = [IO.File]::Open((Join-Path $logs 'build.lock'),'OpenOrCreate','ReadWrite','None')
        try {
            foreach ($arg in @('','-PrepareOnly')) {
                $r = Invoke-SyncFixture $p $arg
                Assert-SyncTest ($r.exitCode -ne 0 -and $r.output.Contains('Another sync build or preparation')) $r.output
                Assert-SyncTest (-not [IO.File]::Exists((Join-Path $p 'scripts/environment-called.txt'))) 'Lock acquired after environment changes.'
            }
            $check = Invoke-SyncFixture $p '-CheckOnly'; Assert-SyncTest ($check.exitCode -eq 0) 'Lock blocked a read-only check.'
        } finally { $held.Dispose() }
        $retry = Invoke-SyncFixture $p '-PrepareOnly'; Assert-SyncTest ($retry.exitCode -eq 0) 'Lock remained after holder released it.'
    }
    Test-SyncBridge 'Failed environment preserves previous EXE and releases lock for retry' {
        $p = New-SyncFixture 'environment-failure'; $old = Get-TestHash (Join-Path $p "scripts/dist/$appName.exe")
        $r = Invoke-SyncFixture $p '' 'environment-failure'
        Assert-SyncTest ($r.exitCode -ne 0 -and $r.output.Contains('Fixture environment unavailable')) $r.output
        Assert-OldPreserved $p $old
        $retry = Invoke-SyncFixture $p '-PrepareOnly'; Assert-SyncTest ($retry.exitCode -eq 0) 'Failure retained build lock.'
    }
    Test-SyncBridge 'Missing resources and unreadable version fail without packaging' {
        foreach ($case in @('asset','version')) {
            $p = New-SyncFixture ('input-' + $case)
            if ($case -eq 'asset') { [IO.File]::Delete((Join-Path $p 'scripts/assets/dongwei-logo.png')) }
            else { [IO.File]::WriteAllText((Join-Path $p 'scripts/label_sync_server.py'),'# no version') }
            $r = Invoke-SyncFixture $p
            Assert-SyncTest ($r.exitCode -ne 0 -and -not [IO.File]::Exists((Join-Path $p 'scripts/python-started.txt'))) 'Invalid input reached packaging.'
        }
    }
    Test-SyncBridge 'Cancelling packaging preserves previous EXE and next build leaves old temporary run alone' {
        $p = New-SyncFixture 'cancel'; $old = Get-TestHash (Join-Path $p "scripts/dist/$appName.exe")
        $running = Start-SyncFixture $p '' 'cancel'; $signal = Join-Path $p 'scripts/python-started.txt'
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        while (-not [IO.File]::Exists($signal) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 30 }
        Assert-SyncTest ([IO.File]::Exists($signal)) 'Cancellation fixture never reached packaging.'
        $oldRun = Split-Path ([IO.File]::ReadAllText($signal)) -Parent
        $running.child.Kill(); $running.child.WaitForExit()
        Assert-OldPreserved $p $old
        Assert-SyncTest ([IO.Directory]::Exists($oldRun)) 'Expected interrupted temporary run absent.'
        $r = Invoke-SyncFixture $p; Assert-SyncTest ($r.exitCode -eq 0) $r.output
        Assert-SyncTest ([IO.Directory]::Exists($oldRun)) 'Next build recursively removed a previous interrupted run.'
    }
    Test-SyncBridge 'Conflicting switches fail before environment or lock files are created' {
        $p = New-SyncFixture 'invalid-switches'; $r = Invoke-SyncFixture $p '-CheckOnly -PrepareOnly'
        Assert-SyncTest ($r.exitCode -ne 0 -and -not [IO.Directory]::Exists((Join-Path $p 'logs'))) $r.output
    }
    Test-SyncBridge 'Redirected temporary directory is rejected without touching its destination' {
        $p = New-SyncFixture 'redirected-temporary'
        $outside = Join-Path $fixtureRoot 'redirect-destination'
        [IO.Directory]::CreateDirectory($outside) | Out-Null
        $sentinel = Join-Path $outside 'keep.txt'; [IO.File]::WriteAllText($sentinel,'preserve')
        $link = Join-Path $p 'scripts/.sync-build-temp'
        New-Item -ItemType Junction -Path $link -Target $outside | Out-Null
        try {
            $r = Invoke-SyncFixture $p
            Assert-SyncTest ($r.exitCode -ne 0 -and $r.output.Contains('Refusing a redirected sync build directory')) $r.output
            Assert-SyncTest ([IO.File]::ReadAllText($sentinel) -eq 'preserve') 'Redirect destination was changed.'
            Assert-SyncTest (-not [IO.File]::Exists((Join-Path $p 'scripts/python-started.txt'))) 'Redirected directory reached packaging.'
        } finally { [IO.Directory]::Delete($link) }
    }
    Test-SyncBridge 'First build publishes one fixed EXE and generates a task ID without GUI input' {
        $p = New-SyncFixture 'initial-publication'
        [IO.File]::Delete((Join-Path $p "scripts/dist/$appName.exe"))
        $r = Invoke-SyncFixture $p '' '' 'CHIPMUNKS_BUILD_GUI' ''
        Assert-SyncTest ($r.exitCode -eq 0) $r.output
        $delivery = Get-Delivery $r; Assert-SingleDelivery $p $delivery
        $verification = [IO.File]::ReadAllText($delivery + '.verification.json') | ConvertFrom-Json
        Assert-SyncTest ([regex]::IsMatch($verification.buildId, '^[a-fA-F0-9]{32}$') -and $r.output.Contains('EXE-BUILD-ID: ' + $verification.buildId)) 'Standalone build did not generate a verified task ID.'
    }
    Test-SyncBridge 'Failed metadata replacement rolls back EXE and both verification files' {
        $p = New-SyncFixture 'metadata-rollback'; $first = Invoke-SyncFixture $p
        Assert-SyncTest ($first.exitCode -eq 0) $first.output
        $delivery = Get-Delivery $first
        $before = @($delivery, ($delivery + '.sha256'), ($delivery + '.verification.json')) | ForEach-Object { Get-TestHash $_ }
        $held = [IO.File]::Open(($delivery + '.verification.json'), 'Open', 'Read', 'Read')
        try { $r = Invoke-SyncFixture $p '' 'alternate' }
        finally { $held.Dispose() }
        Assert-SyncTest ($r.exitCode -ne 0 -and -not $r.output.Contains('BUILD SUCCEEDED')) $r.output
        $after = @($delivery, ($delivery + '.sha256'), ($delivery + '.verification.json')) | ForEach-Object { Get-TestHash $_ }
        Assert-SyncTest (($before -join ':') -eq ($after -join ':')) 'Failed metadata publication did not restore the previous delivery set.'
        Assert-SingleDelivery $p $delivery
    }
    Test-SyncBridge 'First-publication failure leaves no EXE or checksum and preserves obstructing directory' {
        $p = New-SyncFixture 'initial-failure'; $delivery = Join-Path $p "scripts/dist/$appName.exe"
        [IO.File]::Delete($delivery)
        $obstruction = $delivery + '.verification.json'
        [IO.Directory]::CreateDirectory($obstruction) | Out-Null
        $sentinel = Join-Path $obstruction 'keep.txt'; [IO.File]::WriteAllText($sentinel, 'preserve')
        $r = Invoke-SyncFixture $p
        Assert-SyncTest ($r.exitCode -ne 0 -and -not $r.output.Contains('BUILD SUCCEEDED')) $r.output
        Assert-SyncTest (-not [IO.File]::Exists($delivery) -and -not [IO.File]::Exists($delivery + '.sha256')) 'Failed first publication left a partial executable delivery.'
        Assert-SyncTest ([IO.File]::ReadAllText($sentinel) -eq 'preserve') 'Failed publication changed an existing directory.'
    }
    Test-SyncBridge 'Python receives UTF-8 flags and the calling process environment is restored' {
        $parentUtf8 = $env:PYTHONUTF8; $parentIo = $env:PYTHONIOENCODING
        foreach ($mode in @('restore-set','restore-unset')) {
            $p = New-SyncFixture $mode; $r = Invoke-SyncFixture $p '' $mode
            Assert-SyncTest ($r.exitCode -eq 0 -and $r.output.Contains('PYTHON ENVIRONMENT RESTORED') -and $r.output.Contains('UTF8 FIXTURE: 中文路径正常')) $r.output
        }
        Assert-SyncTest ($env:PYTHONUTF8 -eq $parentUtf8 -and $env:PYTHONIOENCODING -eq $parentIo) 'Parent Python environment changed.'
    }
    if (Get-Command python.exe -ErrorAction SilentlyContinue) {
        Test-SyncBridge 'Native Python UTF-8 stdout preserves Chinese paths in redirected logs' {
            $p = New-SyncFixture 'native-encoding'; $r = Invoke-SyncFixture $p '' 'encoding-native'
            Assert-SyncTest ($r.exitCode -eq 0 -and [regex]::IsMatch($r.output, '(?m)^中文路径正常\r?$')) $r.output
        }
    }
    if ($ResultPath) {
        [IO.File]::WriteAllText([IO.Path]::GetFullPath($ResultPath), ([ordered]@{ engine = $PSVersionTable.PSVersion.ToString(); passed = $tests.Count; tests = @($tests.ToArray()) } | ConvertTo-Json -Depth 5), $utf8)
    }
    Write-Host "SYNC BRIDGE TESTS PASSED: $($tests.Count)"
} finally {
    foreach ($child in $activeChildren) { try { if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() } } catch { }; $child.Dispose() }
    # Delete only this uniquely named fixture root, never a computed project path.
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ($fixtureRoot.StartsWith($temp + '\chipmunks-sync-bridge-', [StringComparison]::OrdinalIgnoreCase) -and
        [IO.File]::Exists((Join-Path $fixtureRoot '.sync-fixture-owner'))) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
