param(
  [int]$BackendPort,
  [int]$FrontendPort
)

function Read-CodexWebValue {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Values,
    [Parameter(Mandatory = $true)][string]$Primary,
    [string]$Fallback,
    [Parameter(Mandatory = $true)][string]$Default
  )

  foreach ($key in @($Primary, $Fallback)) {
    if ($key -and $Values.ContainsKey($key)) {
      $value = $Values[$key]
      if ($null -ne $value -and $value.ToString().Trim()) {
        return $value.ToString().Trim()
      }
    }
  }
  return $Default
}

function Read-CodexWebPort {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Values,
    [Parameter(Mandatory = $true)][string]$Primary,
    [string]$Fallback,
    [Parameter(Mandatory = $true)][int]$Default
  )

  $value = Read-CodexWebValue $Values $Primary $Fallback ([string]$Default)
  $parsed = 0
  if (-not [int]::TryParse($value, [ref]$parsed) -or $parsed -lt 1 -or $parsed -gt 65535) {
    $names = $Primary
    if (-not [string]::IsNullOrWhiteSpace($Fallback)) {
      $names = "$Primary or $Fallback"
    }
    throw "Invalid port value for $names`: $value"
  }
  return $parsed
}

function Read-CodexWebConfig {
  param(
    [Parameter(Mandatory = $true)][string]$Root
  )

  $envValues = @{}
  foreach ($path in @(
    (Join-Path $Root ".env"),
    (Join-Path $Root ".evn")
  )) {
    if (-not (Test-Path $path)) { continue }
    foreach ($line in Get-Content -Path $path) {
      $trimmed = $line.Trim()
      if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
      $parts = $trimmed.Split("=", 2)
      $name = $parts[0].Trim()
      if (-not $name) { continue }
      $envValues[$name] = $parts[1]
    }
  }

  return [pscustomobject]@{
    Host = Read-CodexWebValue $envValues "CODEX_WEB_HOST" "HOST" "0.0.0.0"
    BackendPort = Read-CodexWebPort $envValues "CODEX_WEB_BACKEND_PORT" "PORT" 49380
    FrontendPort = Read-CodexWebPort $envValues "CODEX_WEB_FRONTEND_PORT" "FRONTEND_PORT" 49381
    AppServerPort = Read-CodexWebPort $envValues "CODEX_APP_SERVER_PORT" $null 49317
    Password = Read-CodexWebValue $envValues "CODEX_WEB_PASSWORD" "APP_PASSWORD" "root"
  }
}

function Compress-CodexWebLog {
  param(
    [Parameter(Mandatory = $true)][string]$Path
  )

  $source = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    $archivePath = "$Path.$(Get-Date -Format 'yyyyMMdd-HHmmss').gz"
    $target = [System.IO.File]::Create($archivePath)
    try {
      $gzip = [System.IO.Compression.GzipStream]::new($target, [System.IO.Compression.CompressionLevel]::Optimal)
      try {
        $source.CopyTo($gzip)
      } finally {
        $gzip.Dispose()
      }
    } finally {
      $target.Dispose()
    }
  } finally {
    $source.Dispose()
  }

  Clear-Content -Path $Path
}

function Invoke-CodexWebLogRotation {
  param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [long]$MaxBytes = 10485760,
    [int]$MaxArchives = 5
  )

  foreach ($log in Get-ChildItem -Path $Directory -Filter "*.log" -File -ErrorAction SilentlyContinue) {
    if ($log.Length -ge $MaxBytes) {
      Compress-CodexWebLog -Path $log.FullName
    }
  }

  $groups = Get-ChildItem -Path $Directory -Filter "*.log.*.gz" -File -ErrorAction SilentlyContinue |
    Group-Object { $_.Name -replace '\.\d{8}-\d{6}\.gz$', '' }
  foreach ($group in $groups) {
    $group.Group |
      Sort-Object LastWriteTime -Descending |
      Select-Object -Skip $MaxArchives |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
}

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logs = Join-Path $root ".logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
Invoke-CodexWebLogRotation -Directory $logs

$config = Read-CodexWebConfig -Root $root
if (-not $PSBoundParameters.ContainsKey("BackendPort")) {
  $BackendPort = $config.BackendPort
}
if (-not $PSBoundParameters.ContainsKey("FrontendPort")) {
  $FrontendPort = $config.FrontendPort
}

Push-Location $root
try {
  npm.cmd run build

  $ports = @($BackendPort, $FrontendPort)
  $portOwners = Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  $projectProcesses = Get-CimInstance Win32_Process |
    Where-Object {
      $_.CommandLine -like "*$root*" -and
      ($_.CommandLine -like "*tsx*src/index.ts*" -or $_.CommandLine -like "*vite*web/vite.config.ts*")
    } |
    Select-Object -ExpandProperty ProcessId -Unique

  $targets = @(@($portOwners) + @($projectProcesses)) | Where-Object { $_ } | Select-Object -Unique
  foreach ($target in $targets) {
    Stop-Process -Id $target -Force -ErrorAction SilentlyContinue
  }

  Start-Sleep -Milliseconds 700

  Start-Process -FilePath npm.cmd `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $root `
    -RedirectStandardOutput (Join-Path $logs "dev-backend.out.log") `
    -RedirectStandardError (Join-Path $logs "dev-backend.err.log") `
    -WindowStyle Hidden | Out-Null

  Start-Sleep -Seconds 3

  Start-Process -FilePath npm.cmd `
    -ArgumentList @("run", "dev:web") `
    -WorkingDirectory $root `
    -RedirectStandardOutput (Join-Path $logs "dev-frontend.out.log") `
    -RedirectStandardError (Join-Path $logs "dev-frontend.err.log") `
    -WindowStyle Hidden | Out-Null

  Start-Sleep -Seconds 2

  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$BackendPort/health" -TimeoutSec 8
  if (-not $health.ok) {
    throw "Backend health check failed"
  }
  $frontend = Invoke-WebRequest -Uri "http://127.0.0.1:$FrontendPort" -TimeoutSec 8
  if ($frontend.StatusCode -lt 200 -or $frontend.StatusCode -ge 300) {
    throw "Frontend check failed: $($frontend.StatusCode)"
  }

  Write-Host "codex-web dev restarted"
  Write-Host "Backend:  http://127.0.0.1:$BackendPort"
  Write-Host "Frontend: http://127.0.0.1:$FrontendPort"
} finally {
  Pop-Location
}
