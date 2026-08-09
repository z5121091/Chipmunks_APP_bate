param(
  [string]$BackendBaseUrl = '',
  [int]$Port = 19006,
  [int]$ProxyPort = 19007,
  [switch]$NoProxy,
  [switch]$NoOpen,
  [switch]$ClearCache,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$DefaultBackendBaseUrl = ''
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$ClientDir = Join-Path $RepoRoot 'client'
$Url = 'http://localhost:{0}' -f $Port
$ProxyUrl = 'http://localhost:{0}' -f $ProxyPort
$ProxyScript = Join-Path $PSScriptRoot 'local-backend-proxy.mjs'
$ProxyLogPath = Join-Path $RepoRoot 'client\.local-backend-proxy.log'
$ProxyErrorLogPath = Join-Path $RepoRoot 'client\.local-backend-proxy.err.log'
$LocalEnvPath = Join-Path $RepoRoot '.env.local'
$ErpProxyConfigPath = Join-Path $RepoRoot 'server\erp-proxy.config.json'

if (Test-Path -LiteralPath $LocalEnvPath) {
  Get-Content -LiteralPath $LocalEnvPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) {
      return
    }

    $name, $value = $line.Split('=', 2)
    $name = $name.Trim()
    $value = $value.Trim().Trim('"').Trim("'")
    if ($name -and -not [Environment]::GetEnvironmentVariable($name, 'Process')) {
      [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
  }
}

function Test-LocalPort {
  param([int]$TargetPort)

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $asyncResult = $client.BeginConnect('127.0.0.1', $TargetPort, $null, $null)
    if (-not $asyncResult.AsyncWaitHandle.WaitOne(500)) {
      return $false
    }

    $client.EndConnect($asyncResult)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

$ResolvedBackendBaseUrl = $BackendBaseUrl.Trim()
if (-not $ResolvedBackendBaseUrl) {
  $ResolvedBackendBaseUrl = $env:EXPO_PUBLIC_BACKEND_BASE_URL
  if ($ResolvedBackendBaseUrl) {
    $ResolvedBackendBaseUrl = $ResolvedBackendBaseUrl.Trim()
  }
}
if (-not $ResolvedBackendBaseUrl) {
  $ResolvedBackendBaseUrl = $env:CHANJET_PROXY_TARGET_WUXI_DUNENG
  if ($ResolvedBackendBaseUrl) {
    $ResolvedBackendBaseUrl = $ResolvedBackendBaseUrl.Trim()
  }
}
if (-not $ResolvedBackendBaseUrl -and (Test-Path -LiteralPath $ErpProxyConfigPath)) {
  try {
    $proxyConfig = Get-Content -LiteralPath $ErpProxyConfigPath -Raw | ConvertFrom-Json
    $ResolvedBackendBaseUrl = [string]$proxyConfig.targets.'wuxi-duneng'
    if ($ResolvedBackendBaseUrl) {
      $ResolvedBackendBaseUrl = $ResolvedBackendBaseUrl.Trim()
    }
  } catch {
    Write-Host 'ERP proxy config is invalid: server\erp-proxy.config.json' -ForegroundColor Red
    exit 1
  }
}
if (-not $ResolvedBackendBaseUrl) {
  $ResolvedBackendBaseUrl = $DefaultBackendBaseUrl
}
if (-not $ResolvedBackendBaseUrl) {
  Write-Host 'ERP backend URL is not configured.' -ForegroundColor Red
  Write-Host 'Set CHANJET_PROXY_TARGET_WUXI_DUNENG or update server\erp-proxy.config.json.' -ForegroundColor Yellow
  exit 1
}

$FrontendBackendBaseUrl = $ResolvedBackendBaseUrl
if (-not $NoProxy) {
  $FrontendBackendBaseUrl = $ProxyUrl
}

$env:EXPO_PUBLIC_BACKEND_BASE_URL = $FrontendBackendBaseUrl
$env:EXPO_PUBLIC_ERP_WUXI_DUNENG_BASE_URL = $FrontendBackendBaseUrl
$env:EXPO_PUBLIC_ERP_SHANGHAI_CHIPMUNK_BASE_URL = $FrontendBackendBaseUrl
if (-not $env:EXPO_PUBLIC_BACKEND_ACCESS_KEY -and $env:BACKEND_ACCESS_KEY) {
  $env:EXPO_PUBLIC_BACKEND_ACCESS_KEY = $env:BACKEND_ACCESS_KEY
}

$expoArgs = @('exec', 'expo', 'start', '--web', '--offline', '--port', [string]$Port)
if ($ClearCache) {
  $expoArgs += '--clear'
}

Write-Host ''
Write-Host 'Palm Warehouse local Web preview' -ForegroundColor Cyan
Write-Host ('URL: {0}' -f $Url)
Write-Host ('Frontend backend: {0}' -f $FrontendBackendBaseUrl)
if (-not $NoProxy) {
  Write-Host ('Proxy target: {0}' -f $ResolvedBackendBaseUrl)
}
Write-Host ''

if ($DryRun) {
  Write-Host ('Working directory: {0}' -f $ClientDir)
  if (-not $NoProxy) {
    Write-Host ('Proxy command: node "{0}" --target "{1}" --port {2}' -f $ProxyScript, $ResolvedBackendBaseUrl, $ProxyPort)
  }
  Write-Host ('Command: pnpm {0}' -f ($expoArgs -join ' '))
  exit 0
}

$nodeCommand = & where.exe node 2>$null | Select-Object -First 1
if (-not $nodeCommand) {
  Write-Host 'node was not found. Please install Node.js first.' -ForegroundColor Red
  exit 1
}

$pnpmCommand = & where.exe pnpm 2>$null
if (-not $pnpmCommand) {
  Write-Host 'pnpm was not found. Please install project dependencies first.' -ForegroundColor Red
  exit 1
}

if (-not $NoProxy) {
  if (Test-LocalPort -TargetPort $ProxyPort) {
    Write-Host ('Local backend proxy is already running at {0}.' -f $ProxyUrl) -ForegroundColor Yellow
  } else {
    Write-Host ('Starting local backend proxy at {0}...' -f $ProxyUrl)
    Start-Process `
      -FilePath $nodeCommand `
      -ArgumentList @($ProxyScript, '--target', $ResolvedBackendBaseUrl, '--port', [string]$ProxyPort) `
      -WorkingDirectory $RepoRoot `
      -RedirectStandardOutput $ProxyLogPath `
      -RedirectStandardError $ProxyErrorLogPath `
      -WindowStyle Hidden | Out-Null

    for ($index = 0; $index -lt 20; $index += 1) {
      if (Test-LocalPort -TargetPort $ProxyPort) {
        break
      }

      Start-Sleep -Milliseconds 300
    }
  }
}

if (Test-LocalPort -TargetPort $Port) {
  Write-Host ('{0} is already running. Opening browser.' -f $Url) -ForegroundColor Yellow
  Write-Host 'If ERP fetch still fails, close the existing Expo window and run this script again.' -ForegroundColor Yellow
  if (-not $NoOpen) {
    Start-Process $Url
  }
  exit 0
}

if (-not $NoOpen) {
  Start-Job -ScriptBlock {
    param([string]$OpenUrl, [int]$OpenPort)

    function Test-LocalPortInJob {
      param([int]$TargetPort)

      $client = [System.Net.Sockets.TcpClient]::new()
      try {
        $asyncResult = $client.BeginConnect('127.0.0.1', $TargetPort, $null, $null)
        if (-not $asyncResult.AsyncWaitHandle.WaitOne(500)) {
          return $false
        }

        $client.EndConnect($asyncResult)
        return $true
      } catch {
        return $false
      } finally {
        $client.Close()
      }
    }

    for ($index = 0; $index -lt 90; $index += 1) {
      if (Test-LocalPortInJob -TargetPort $OpenPort) {
        Start-Process $OpenUrl
        return
      }

      Start-Sleep -Seconds 1
    }

    Start-Process $OpenUrl
  } -ArgumentList $Url, $Port | Out-Null
}

Set-Location $ClientDir
& pnpm @expoArgs
exit $LASTEXITCODE
