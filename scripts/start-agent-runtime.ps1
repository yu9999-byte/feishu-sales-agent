param(
  [ValidateRange(1, 65535)][int]$Port = 3100,
  [ValidateRange(1, 120)][int]$ReadyWaitSeconds = 30
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot 'logs'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$readinessScript = Join-Path $PSScriptRoot 'agent-runtime-health.mjs'
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen `
  -ErrorAction SilentlyContinue | Select-Object -First 1

if ($null -ne $listener) {
  $process = Get-CimInstance Win32_Process `
    -Filter "ProcessId = $($listener.OwningProcess)"
  if ($process.CommandLine -match 'dist[/\\]server[/\\]agent\.main\.js') {
    & $nodePath $readinessScript --port $Port --wait-ms ($ReadyWaitSeconds * 1000)
    if ($LASTEXITCODE -ne 0) { throw 'Agent process is running but is not ready.' }
    exit 0
  }
  throw "Port $Port is already used by a different process."
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$standardOutput = Join-Path $logDirectory 'agent-runtime.stdout.log'
$standardError = Join-Path $logDirectory 'agent-runtime.stderr.log'

$previousPort = $env:AGENT_PORT
try {
  $env:AGENT_PORT = [string]$Port
  Start-Process `
    -FilePath $nodePath `
    -ArgumentList @('dist/server/agent.main.js') `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $standardOutput `
    -RedirectStandardError $standardError
} finally {
  $env:AGENT_PORT = $previousPort
}

& $nodePath $readinessScript --port $Port --wait-ms ($ReadyWaitSeconds * 1000)
if ($LASTEXITCODE -ne 0) { throw 'Agent did not become ready; check runtime logs and database migrations.' }
