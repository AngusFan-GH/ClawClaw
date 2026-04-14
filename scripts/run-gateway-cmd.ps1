param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,

  [Parameter(Mandatory = $true)]
  [ValidateSet('gateway stop', 'gateway uninstall')]
  [string]$Command
)

$ErrorActionPreference = 'Stop'

$installDir = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$nodeExe = Join-Path $installDir 'resources\bin\node.exe'
$entryScript = Join-Path $installDir 'resources\openclaw\openclaw.mjs'

if (-not (Test-Path -LiteralPath $nodeExe)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $nodeCommand) {
    $nodeExe = $nodeCommand.Source
  }
}

if ([string]::IsNullOrWhiteSpace($nodeExe)) {
  exit 1
}

$openclawCwd = Join-Path $installDir 'resources\openclaw'
$previousEmbeddedIn = [Environment]::GetEnvironmentVariable('OPENCLAW_EMBEDDED_IN', 'Process')

try {
  [Environment]::SetEnvironmentVariable('OPENCLAW_EMBEDDED_IN', 'ClawClaw', 'Process')
  Push-Location $openclawCwd
  try {
    & $nodeExe '--disable-warning=ExperimentalWarning' $entryScript $Command.Split(' ')
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  [Environment]::SetEnvironmentVariable('OPENCLAW_EMBEDDED_IN', $previousEmbeddedIn, 'Process')
}
