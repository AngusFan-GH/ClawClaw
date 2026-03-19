param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$ErrorActionPreference = 'Stop'

function Quote-WindowsArgument {
  param([string]$Value)

  if ($null -eq $Value) {
    return '""'
  }

  if ($Value -eq '') {
    return '""'
  }

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  $escaped = $Value -replace '(\\*)"', '$1$1\"'
  $escaped = $escaped -replace '(\\+)$', '$1$1'
  return '"' + $escaped + '"'
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$entryScript = Join-Path $installDir 'resources\openclaw\openclaw.mjs'
$openclawCwd = Join-Path $installDir 'resources\openclaw'
$bundledNode = Join-Path $installDir 'resources\bin\node.exe'

if ($CliArgs.Count -gt 0 -and $CliArgs[0] -ieq 'update') {
  Write-Output 'openclaw is managed by ClawClaw (bundled version).'
  Write-Output ''
  Write-Output 'To update openclaw, update ClawClaw:'
  Write-Output '  Open ClawClaw > Settings > Check for Updates'
  Write-Output '  Or download the latest version from https://clawclaw.xzinfra.com'
  exit 0
}

if (-not (Test-Path -LiteralPath $entryScript)) {
  Write-Error "OpenClaw entry script not found at $entryScript"
  exit 1
}

$nodeExe = $bundledNode
if (-not (Test-Path -LiteralPath $nodeExe)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $nodeCommand) {
    $nodeExe = $nodeCommand.Source
  }
}

if ([string]::IsNullOrWhiteSpace($nodeExe)) {
  Write-Error 'No bundled node.exe was found and "node" is not available on PATH. Reinstall ClawClaw with the Windows CLI runtime included.'
  exit 1
}

$previousEmbeddedIn = [Environment]::GetEnvironmentVariable('OPENCLAW_EMBEDDED_IN', 'Process')

try {
  [Environment]::SetEnvironmentVariable('OPENCLAW_EMBEDDED_IN', 'ClawClaw', 'Process')
  Push-Location $openclawCwd
  try {
    & $nodeExe '--disable-warning=ExperimentalWarning' $entryScript @CliArgs
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  [Environment]::SetEnvironmentVariable('OPENCLAW_EMBEDDED_IN', $previousEmbeddedIn, 'Process')
}
