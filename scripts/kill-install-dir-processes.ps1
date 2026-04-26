param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir
)

$ErrorActionPreference = 'Stop'

function Normalize-Path([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $null
  }

  try {
    return [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\')
  } catch {
    return $null
  }
}

$normalizedInstallDir = Normalize-Path $InstallDir
if ([string]::IsNullOrWhiteSpace($normalizedInstallDir)) {
  exit 0
}

$escapedInstallDir = [Regex]::Escape($normalizedInstallDir)
$commandLineOnlyProcessNames = @(
  'ClawClaw.exe',
  'node.exe',
  'uv.exe'
)

$matchingProcesses = Get-CimInstance Win32_Process | Where-Object {
  if ($_.ProcessId -eq $PID) {
    return $false
  }

  $processName = [string]$_.Name
  if ($processName -like 'Uninstall*.exe') {
    return $false
  }

  $exePath = Normalize-Path $_.ExecutablePath
  if ($exePath -and $exePath.StartsWith($normalizedInstallDir, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }

  if (
    $_.CommandLine -and
    $_.CommandLine -match $escapedInstallDir -and
    $commandLineOnlyProcessNames -contains $processName
  ) {
    return $true
  }

  return $false
}

foreach ($proc in $matchingProcesses) {
  try {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
  } catch {
    # Best-effort cleanup. The installer should continue even if a process
    # has already exited or requires higher privileges.
  }
}

Start-Sleep -Seconds 2
exit 0
