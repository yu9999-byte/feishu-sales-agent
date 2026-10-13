$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot 'logs'
$logPath = Join-Path $logDirectory 'proactive-sales-notifications.log'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location -LiteralPath $projectRoot

$startedAt = (Get-Date).ToString('o')
$output = & node `
  --env-file=.env.local `
  scripts/proactive-sales-notification-runner.mjs 2>&1 | Out-String
$runnerExitCode = $LASTEXITCODE

Add-Content -LiteralPath $logPath -Value (
  "[$startedAt] exit=$runnerExitCode $($output.Trim())"
)
exit $runnerExitCode
