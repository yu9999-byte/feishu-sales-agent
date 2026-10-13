$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot 'logs'
$listener = Get-NetTCPConnection -LocalPort 3100 -State Listen `
  -ErrorAction SilentlyContinue | Select-Object -First 1

if ($null -ne $listener) {
  $process = Get-CimInstance Win32_Process `
    -Filter "ProcessId = $($listener.OwningProcess)"
  if ($process.CommandLine -match 'dist[/\\]server[/\\]agent\.main\.js') {
    exit 0
  }
  throw 'Port 3100 is already used by a different process.'
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$nodePath = (Get-Command node -ErrorAction Stop).Source
$standardOutput = Join-Path $logDirectory 'agent-runtime.stdout.log'
$standardError = Join-Path $logDirectory 'agent-runtime.stderr.log'

Start-Process `
  -FilePath $nodePath `
  -ArgumentList @('dist/server/agent.main.js') `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $standardOutput `
  -RedirectStandardError $standardError
