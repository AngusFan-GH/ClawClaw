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

function ConvertTo-ProcessArgument {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  if ($Value.Length -eq 0) {
    return '""'
  }

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  $result = '"'
  $backslashes = 0
  foreach ($char in $Value.ToCharArray()) {
    if ($char -eq '\') {
      $backslashes += 1
      continue
    }

    if ($char -eq '"') {
      $result += ('\' * (($backslashes * 2) + 1))
      $result += '"'
      $backslashes = 0
      continue
    }

    if ($backslashes -gt 0) {
      $result += ('\' * $backslashes)
      $backslashes = 0
    }
    $result += $char
  }

  if ($backslashes -gt 0) {
    $result += ('\' * ($backslashes * 2))
  }

  $result += '"'
  return $result
}

try {
  Write-Output "[OpenClaw validation] Running dependency probe with bundled Node..."

  $arguments = @(
    '--disable-warning=ExperimentalWarning',
    $scriptPath,
    $openclawDir
  ) | ForEach-Object { ConvertTo-ProcessArgument $_ }

  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  $processInfo.FileName = $nodeExe
  $processInfo.WorkingDirectory = $openclawDir
  $processInfo.Arguments = ($arguments -join ' ')
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $processInfo.EnvironmentVariables['OPENCLAW_EMBEDDED_IN'] = 'ClawClaw'

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $processInfo
  [void]$process.Start()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.Result
  $stderr = $stderrTask.Result
  $exitCode = $process.ExitCode

  if (-not [string]::IsNullOrWhiteSpace($stdout)) {
    $stdout -split "\r?\n" | Where-Object { $_ -ne '' } | ForEach-Object { Write-Output $_ }
  }

  if (-not [string]::IsNullOrWhiteSpace($stderr)) {
    if ($exitCode -eq 0) {
      $stderr -split "\r?\n" | Where-Object { $_ -ne '' } | ForEach-Object { Write-Output "[OpenClaw validation] stderr: $_" }
    } else {
      $stderr -split "\r?\n" | Where-Object { $_ -ne '' } | ForEach-Object { Write-Output "[OpenClaw validation] ERROR: $_" }
    }
  }

  if ($exitCode -eq 0) {
    Write-Output "[OpenClaw validation] Dependency probe passed."
  } else {
    Write-Output "[OpenClaw validation] Dependency probe failed with exit code $exitCode."
  }
  exit $exitCode
} catch {
  Write-Output "[OpenClaw validation] ERROR: Failed to launch dependency probe: $($_.Exception.Message)"
  exit 1
}
