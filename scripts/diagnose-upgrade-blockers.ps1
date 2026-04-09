param(
  [string]$InstallDir,
  [int]$WatchSeconds = 0
)

$ErrorActionPreference = 'Stop'

function Normalize-PathValue([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $null
  }

  try {
    return [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\')
  } catch {
    return $null
  }
}

function Get-UninstallEntries {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )

  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }

    Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $item = Get-ItemProperty $_.PSPath -ErrorAction Stop
        if ($item.DisplayName -eq 'ClawClaw' -or ($item.InstallLocation -and $item.InstallLocation -match 'ClawClaw')) {
          [pscustomobject]@{
            RegistryPath     = $_.PSPath
            DisplayName      = $item.DisplayName
            DisplayVersion   = $item.DisplayVersion
            InstallLocation  = Normalize-PathValue $item.InstallLocation
            UninstallString  = $item.UninstallString
            QuietUninstall   = $item.QuietUninstallString
          }
        }
      } catch {
      }
    }
  }
}

function Get-TrackedPaths([string]$BaseDir) {
  $candidates = @(
    (Join-Path $BaseDir 'ClawClaw.exe'),
    (Join-Path $BaseDir 'Uninstall ClawClaw.exe'),
    (Join-Path $BaseDir 'resources\bin\node.exe'),
    (Join-Path $BaseDir 'resources\bin\uv.exe'),
    (Join-Path $BaseDir 'resources\openclaw\openclaw.mjs'),
    (Join-Path $BaseDir 'resources\app.asar')
  )

  return $candidates | Where-Object { Test-Path $_ }
}

function Test-ExclusiveOpen([string]$PathValue) {
  try {
    $stream = [System.IO.File]::Open($PathValue, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $stream.Dispose()
    return [pscustomobject]@{
      Path = $PathValue
      Locked = $false
      Message = 'exclusive-open-ok'
    }
  } catch {
    return [pscustomobject]@{
      Path = $PathValue
      Locked = $true
      Message = $_.Exception.Message
    }
  }
}

function Get-InstallDirProcesses([string]$BaseDir) {
  $normalized = Normalize-PathValue $BaseDir
  if (-not $normalized) { return @() }

  $escaped = [Regex]::Escape($normalized)
  Get-CimInstance Win32_Process | Where-Object {
    $exePath = Normalize-PathValue $_.ExecutablePath
    if ($exePath -and $exePath.StartsWith($normalized, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }

    if ($_.CommandLine -and $_.CommandLine -match $escaped) {
      return $true
    }

    return $false
  } | Sort-Object ProcessId | ForEach-Object {
    [pscustomobject]@{
      ProcessId    = $_.ProcessId
      Name         = $_.Name
      Executable   = Normalize-PathValue $_.ExecutablePath
      ParentPid    = $_.ParentProcessId
      CommandLine  = $_.CommandLine
    }
  }
}

function Get-RelatedServices([string]$BaseDir) {
  $normalized = Normalize-PathValue $BaseDir
  if (-not $normalized) { return @() }

  Get-CimInstance Win32_Service | Where-Object {
    $_.PathName -and $_.PathName.IndexOf($normalized, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  } | Select-Object Name, State, StartMode, PathName
}

function Get-RelatedTasks([string]$BaseDir) {
  $normalized = Normalize-PathValue $BaseDir
  if (-not $normalized) { return @() }

  $result = @()
  foreach ($task in Get-ScheduledTask -ErrorAction SilentlyContinue) {
    foreach ($action in $task.Actions) {
      $joined = @($action.Execute, $action.Arguments, $action.WorkingDirectory) -join ' '
      if ($joined.IndexOf($normalized, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $result += [pscustomobject]@{
          TaskName      = $task.TaskName
          TaskPath      = $task.TaskPath
          State         = $task.State
          Execute       = $action.Execute
          Arguments     = $action.Arguments
          WorkingDir    = $action.WorkingDirectory
        }
      }
    }
  }
  return $result
}

function Write-Section([string]$Title, $Data) {
  Write-Host ""
  Write-Host "=== $Title ==="
  if ($null -eq $Data) {
    Write-Host "(null)"
    return
  }
  if ($Data -is [System.Array] -and $Data.Count -eq 0) {
    Write-Host "(none)"
    return
  }
  $Data | Format-List | Out-String | Write-Host
}

$entries = @(Get-UninstallEntries)
$resolvedInstallDir = Normalize-PathValue $InstallDir
if (-not $resolvedInstallDir) {
  $resolvedInstallDir = $entries |
    Where-Object { $_.InstallLocation } |
    Select-Object -First 1 -ExpandProperty InstallLocation
}

Write-Host "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "ResolvedInstallDir: $resolvedInstallDir"

Write-Section 'Registry Entries' $entries

if (-not $resolvedInstallDir) {
  Write-Host ""
  Write-Host "No install directory was resolved. Pass -InstallDir explicitly."
  exit 1
}

$trackedPaths = Get-TrackedPaths $resolvedInstallDir
Write-Section 'Tracked Paths' $trackedPaths
Write-Section 'Exclusive Open Probes' (@($trackedPaths | ForEach-Object { Test-ExclusiveOpen $_ }))
Write-Section 'Processes Referencing InstallDir' (@(Get-InstallDirProcesses $resolvedInstallDir))
Write-Section 'Services Referencing InstallDir' (@(Get-RelatedServices $resolvedInstallDir))
Write-Section 'Scheduled Tasks Referencing InstallDir' (@(Get-RelatedTasks $resolvedInstallDir))

if ($WatchSeconds -gt 0) {
  Write-Host ""
  Write-Host "=== Watching Process Respawns (${WatchSeconds}s) ==="
  for ($i = 1; $i -le $WatchSeconds; $i++) {
    $snapshot = @(Get-InstallDirProcesses $resolvedInstallDir)
    $names = if ($snapshot.Count -gt 0) {
      ($snapshot | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ', '
    } else {
      '(none)'
    }
    Write-Host ("[{0:00}s] {1}" -f $i, $names)
    Start-Sleep -Seconds 1
  }
}
