param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir
)

$ErrorActionPreference = 'Stop'

$installDir = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$nodeExe = Join-Path $installDir 'resources\bin\node.exe'
$scriptCandidates = @(
  (Join-Path $installDir 'resources\resources\scripts\validate-openclaw-runtime.cjs'),
  (Join-Path $installDir 'resources\scripts\validate-openclaw-runtime.cjs')
)
$openclawDir = Join-Path $installDir 'resources\openclaw'

Write-Output "[OpenClaw validation] Install directory: $installDir"
Write-Output "[OpenClaw validation] Checking bundled node.exe: $nodeExe"
if (-not (Test-Path -LiteralPath $nodeExe)) {
  Write-Output "[OpenClaw validation] ERROR: Missing bundled node.exe: $nodeExe"
  exit 1
}

Write-Output "[OpenClaw validation] Locating validation script..."
$scriptPath = $scriptCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($scriptPath) -or -not (Test-Path -LiteralPath $scriptPath)) {
  Write-Output "[OpenClaw validation] ERROR: Missing runtime validation script. Tried: $($scriptCandidates -join '; ')"
  exit 1
}
Write-Output "[OpenClaw validation] Validation script: $scriptPath"

Write-Output "[OpenClaw validation] Checking OpenClaw runtime directory: $openclawDir"
if (-not (Test-Path -LiteralPath $openclawDir)) {
  Write-Output "[OpenClaw validation] ERROR: Missing bundled OpenClaw directory: $openclawDir"
  exit 1
}

$stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) ("clawclaw-runtime-validate-" + [System.Guid]::NewGuid().ToString("N") + ".out.log")
$stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ("clawclaw-runtime-validate-" + [System.Guid]::NewGuid().ToString("N") + ".err.log")

try {
  $previousEmbeddedIn = [Environment]::GetEnvironmentVariable('OPENCLAW_EMBEDDED_IN', 'Process')
  [Environment]::SetEnvironmentVariable('OPENCLAW_EMBEDDED_IN', 'ClawClaw', 'Process')
  Write-Output "[OpenClaw validation] Running dependency probe with bundled Node..."
  Push-Location $openclawDir
  try {
    # Use PowerShell's native invocation so each path remains a distinct
    # argument. Process-launch helpers flatten arrays into a command line and
    # can split paths such as "C:\Program Files\ClawClaw\...".
    & $nodeExe '--disable-warning=ExperimentalWarning' $scriptPath $openclawDir 1> $stdoutPath 2> $stderrPath
    $exitCode = if ($null -eq $LASTEXITCODE) { 1 } else { $LASTEXITCODE }
  } finally {
    Pop-Location
  }

  if (Test-Path -LiteralPath $stdoutPath) {
    Get-Content -LiteralPath $stdoutPath | ForEach-Object { Write-Output $_ }
  }

  if (Test-Path -LiteralPath $stderrPath) {
    if ($exitCode -eq 0) {
      Get-Content -LiteralPath $stderrPath | ForEach-Object { Write-Output "[OpenClaw validation] stderr: $_" }
    } else {
      Get-Content -LiteralPath $stderrPath | ForEach-Object { Write-Output "[OpenClaw validation] ERROR: $_" }
    }
  }

  if ($exitCode -eq 0) {
    Write-Output "[OpenClaw validation] Dependency probe passed."
  } else {
    Write-Output "[OpenClaw validation] Dependency probe failed with exit code $exitCode."
  }
  exit $exitCode
} finally {
  [Environment]::SetEnvironmentVariable('OPENCLAW_EMBEDDED_IN', $previousEmbeddedIn, 'Process')
  Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
}
