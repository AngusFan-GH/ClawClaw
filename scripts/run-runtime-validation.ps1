param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir
)

$ErrorActionPreference = 'Stop'

$installDir = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$nodeExe = Join-Path $installDir 'resources\bin\node.exe'
$scriptPath = Join-Path $installDir 'resources\resources\scripts\validate-openclaw-runtime.cjs'
$openclawDir = Join-Path $installDir 'resources\openclaw'

if (-not (Test-Path -LiteralPath $nodeExe)) {
  Write-Error "Missing bundled node.exe: $nodeExe"
  exit 1
}

if (-not (Test-Path -LiteralPath $scriptPath)) {
  Write-Error "Missing runtime validation script: $scriptPath"
  exit 1
}

if (-not (Test-Path -LiteralPath $openclawDir)) {
  Write-Error "Missing bundled OpenClaw directory: $openclawDir"
  exit 1
}

$stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) ("clawclaw-runtime-validate-" + [System.Guid]::NewGuid().ToString("N") + ".out.log")
$stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ("clawclaw-runtime-validate-" + [System.Guid]::NewGuid().ToString("N") + ".err.log")

try {
  $child = Start-Process `
    -FilePath $nodeExe `
    -ArgumentList @($scriptPath, $openclawDir) `
    -WorkingDirectory $openclawDir `
    -WindowStyle Hidden `
    -Wait `
    -PassThru `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath

  if (Test-Path -LiteralPath $stdoutPath) {
    Get-Content -LiteralPath $stdoutPath | ForEach-Object { Write-Output $_ }
  }

  if (Test-Path -LiteralPath $stderrPath) {
    Get-Content -LiteralPath $stderrPath | ForEach-Object { Write-Error $_ }
  }

  exit $child.ExitCode
} finally {
  Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
}
