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
$appExe = Join-Path $installDir 'ClawClaw.exe'
$entryScript = Join-Path $installDir 'resources\openclaw\openclaw.mjs'
$openclawCwd = Join-Path $installDir 'resources\openclaw'

if ($CliArgs.Count -gt 0 -and $CliArgs[0] -ieq 'update') {
  Write-Output 'openclaw is managed by ClawClaw (bundled version).'
  Write-Output ''
  Write-Output 'To update openclaw, update ClawClaw:'
  Write-Output '  Open ClawClaw > Settings > Check for Updates'
  Write-Output '  Or download the latest version from https://claw-x.com'
  exit 0
}

if (-not (Test-Path -LiteralPath $appExe)) {
  Write-Error "ClawClaw executable not found at $appExe"
  exit 1
}

if (-not (Test-Path -LiteralPath $entryScript)) {
  Write-Error "OpenClaw entry script not found at $entryScript"
  exit 1
}

$allArgs = @($entryScript) + $CliArgs
$argumentLine = ($allArgs | ForEach-Object { Quote-WindowsArgument $_ }) -join ' '

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $appExe
$psi.Arguments = $argumentLine
$psi.WorkingDirectory = $openclawCwd
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$psi.Environment['ELECTRON_RUN_AS_NODE'] = '1'
$psi.Environment['OPENCLAW_EMBEDDED_IN'] = 'ClawClaw'
$psi.Environment['OPENCLAW_NO_RESPAWN'] = '1'

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi

$stdoutDone = New-Object System.Threading.ManualResetEvent($false)
$stderrDone = New-Object System.Threading.ManualResetEvent($false)

$stdoutHandler = [System.Diagnostics.DataReceivedEventHandler]{
  param($sender, $eventArgs)
  if ($null -eq $eventArgs.Data) {
    $stdoutDone.Set() | Out-Null
  } else {
    [Console]::Out.WriteLine($eventArgs.Data)
  }
}

$stderrHandler = [System.Diagnostics.DataReceivedEventHandler]{
  param($sender, $eventArgs)
  if ($null -eq $eventArgs.Data) {
    $stderrDone.Set() | Out-Null
  } else {
    [Console]::Error.WriteLine($eventArgs.Data)
  }
}

$process.add_OutputDataReceived($stdoutHandler)
$process.add_ErrorDataReceived($stderrHandler)

try {
  if (-not $process.Start()) {
    Write-Error 'Failed to start ClawClaw CLI process.'
    exit 1
  }

  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()
  $process.WaitForExit()
  $stdoutDone.WaitOne() | Out-Null
  $stderrDone.WaitOne() | Out-Null
  exit $process.ExitCode
} finally {
  $process.remove_OutputDataReceived($stdoutHandler)
  $process.remove_ErrorDataReceived($stderrHandler)
  $process.Dispose()
  $stdoutDone.Dispose()
  $stderrDone.Dispose()
}
