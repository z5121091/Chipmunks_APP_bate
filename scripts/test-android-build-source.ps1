$ErrorActionPreference = 'Stop'
$buildScript = Join-Path $PSScriptRoot 'build-android-release.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($buildScript, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($name in @('Assert-BuildSources', 'Sync-BuildSourceFolder')) {
    $definition = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $false))
    if ($definition.Count -ne 1) { throw "Expected one build helper: $name" }
    . ([scriptblock]::Create($definition[0].Extent.Text))
}

$fixture = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('chipmunks-build-source-test-' + [guid]::NewGuid().ToString('N')))).TrimEnd('\')
$passed = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function Assert-Throws {
    param([scriptblock]$Action, [string]$Expected)
    $caught = $null
    try { & $Action } catch { $caught = $_.Exception.Message }
    if (-not $caught -or $caught -notlike "*$Expected*") { throw "Expected '$Expected'; received '$caught'" }
}
function Test-Case {
    param([string]$Name, [scriptblock]$Action)
    & $Action
    $script:passed++
    Write-Host "PASS: $Name"
}
function Assert-FixturePath {
    param([string]$Path)
    $absolute = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($absolute -ne $fixture -and -not $absolute.StartsWith($fixture + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing cleanup outside test fixture: $absolute"
    }
    return $absolute
}
function Remove-FixtureTree {
    param([string]$Path)
    $absolute = Assert-FixturePath $Path
    if (Test-Path -LiteralPath $absolute) { Remove-Item -LiteralPath $absolute -Recurse -Force }
}

try {
    $source = Join-Path $fixture 'source'
    $cache = Join-Path $fixture 'cache'
    New-Item -ItemType Directory -Path (Join-Path $source 'client/android'), (Join-Path $source 'server'), $cache -Force | Out-Null
    foreach ($file in @('package.json', 'client/package.json', 'server/package.json')) { [IO.File]::WriteAllText((Join-Path $source $file), '{}') }
    foreach ($file in @('pnpm-workspace.yaml', 'pnpm-lock.yaml', '.npmrc')) { [IO.File]::WriteAllText((Join-Path $source $file), '') }

    Test-Case 'optional patches are not required build inputs' { Assert-BuildSources $source }
    Test-Case 'missing optional patches succeed and reset stale exit code' {
        $global:LASTEXITCODE = 16
        Sync-BuildSourceFolder $source $cache 'patches'
        Assert-True ($LASTEXITCODE -eq 0) 'Missing optional folder retained a failing exit code.'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $cache 'patches'))) 'Missing patches created an unnecessary cache folder.'
    }
    Test-Case 'existing patches mirror files and remove obsolete cached files' {
        New-Item -ItemType Directory -Path (Join-Path $source 'patches'), (Join-Path $cache 'patches') | Out-Null
        [IO.File]::WriteAllText((Join-Path $source 'patches/current.patch'), 'current patch contents')
        [IO.File]::WriteAllText((Join-Path $cache 'patches/obsolete.patch'), 'obsolete')
        Sync-BuildSourceFolder $source $cache 'patches'
        Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $cache 'patches/current.patch')) -eq 'current patch contents') 'Patch was not copied intact.'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $cache 'patches/obsolete.patch'))) 'Obsolete cached patch survived mirror.'
    }
    Test-Case 'removing optional source patches removes stale cache patches' {
        Remove-FixtureTree (Join-Path $source 'patches')
        Sync-BuildSourceFolder $source $cache 'patches'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $cache 'patches'))) 'Stale cached patch folder survived.'
    }
    Test-Case 'missing required client source is rejected' {
        Assert-Throws { Sync-BuildSourceFolder (Join-Path $fixture 'missing-source') $cache 'client' } 'Missing required source directory: client'
    }
    Test-Case 'missing Android source is rejected by preflight' {
        Remove-FixtureTree (Join-Path $source 'client/android')
        try { Assert-Throws { Assert-BuildSources $source } 'Missing required build input: client/android' }
        finally { New-Item -ItemType Directory -Path (Join-Path $source 'client/android') | Out-Null }
    }
    foreach ($manifest in @('package.json', 'client/package.json', 'server/package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml')) {
        Test-Case "missing patches referenced by $manifest are rejected" {
            $path = Join-Path $source $manifest
            $original = [IO.File]::ReadAllText($path)
            try {
                $content = if ($manifest.EndsWith('.json')) { '{"pnpm":{"patchedDependencies":{"demo@1.0.0":"patches/demo.patch"}}}' } else { "patchedDependencies:`n  demo@1.0.0: patches/demo.patch`n" }
                [IO.File]::WriteAllText($path, $content)
                Assert-Throws { Assert-BuildSources $source } "Missing patches directory referenced by $manifest"
            } finally { [IO.File]::WriteAllText($path, $original) }
        }
    }
    Test-Case 'redirected cache patch folder is rejected without touching its target' {
        $redirected = Join-Path $fixture 'redirect-target'
        $junction = Join-Path $cache 'patches'
        New-Item -ItemType Directory -Path $redirected | Out-Null
        [IO.File]::WriteAllText((Join-Path $redirected 'sentinel.txt'), 'preserve')
        New-Item -ItemType Junction -Path $junction -Target $redirected | Out-Null
        try {
            Assert-Throws { Sync-BuildSourceFolder $source $cache 'patches' } 'Refusing a redirected build directory'
            Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $redirected 'sentinel.txt')) -eq 'preserve') 'Redirect target was altered.'
        } finally {
            # Delete the junction itself, never traverse its target (also safe on Windows PowerShell 5.1).
            $safeJunction = Assert-FixturePath $junction
            [IO.Directory]::Delete($safeJunction)
        }
    }
    Write-Host "PASSED: $passed source synchronization checks (PowerShell $($PSVersionTable.PSVersion)). No APK build was started."
} finally {
    Remove-FixtureTree $fixture
}
