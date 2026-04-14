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
    $child = Start-Process `
      -FilePath $nodeExe `
      -ArgumentList @('--disable-warning=ExperimentalWarning', $entryScript) + $Command.Split(' ') `
      -WorkingDirectory $openclawCwd `
      -WindowStyle Hidden `
      -Wait `
      -PassThru
    exit $child.ExitCode
  } finally {
    Pop-Location
  }
} finally {
  [Environment]::SetEnvironmentVariable('OPENCLAW_EMBEDDED_IN', $previousEmbeddedIn, 'Process')
}
