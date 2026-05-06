param(
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

function Test-ClawClawEntry($Item) {
  $displayName = [string]$Item.DisplayName
  $installLocation = [string]$Item.InstallLocation
  $uninstallString = [string]$Item.UninstallString
  $quietUninstallString = [string]$Item.QuietUninstallString

  if ($displayName -eq 'ClawClaw') { return $true }
  if ($installLocation -match 'ClawClaw') { return $true }
  if ($uninstallString -match 'ClawClaw') { return $true }
  if ($quietUninstallString -match 'ClawClaw') { return $true }
  if ($uninstallString -match '\$\{productName\}') { return $true }
  if ($quietUninstallString -match '\$\{productName\}') { return $true }
  return $false
}

function Remove-RegistryTree([string]$PathValue) {
  if (-not (Test-Path -LiteralPath $PathValue)) { return }

  if ($WhatIf) {
    Write-Host "[what-if] Remove registry key: $PathValue"
    return
  }

  Remove-Item -LiteralPath $PathValue -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Removed registry key: $PathValue"
}

function Remove-PathIfExists([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return }
  if (-not (Test-Path -LiteralPath $PathValue)) { return }

  if ($WhatIf) {
    Write-Host "[what-if] Remove path: $PathValue"
    return
  }

  Remove-Item -LiteralPath $PathValue -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Removed path: $PathValue"
}

function Join-ExistingBasePath([string]$BasePath, [string]$ChildPath) {
  if ([string]::IsNullOrWhiteSpace($BasePath)) {
    return $null
  }

  return Join-Path $BasePath $ChildPath
}

$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

foreach ($root in $uninstallRoots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }

  Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $item = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop
      if (Test-ClawClawEntry $item) {
        Remove-RegistryTree $_.PSPath
      }
    } catch {
      Write-Warning "Failed to inspect registry key $($_.PSPath): $($_.Exception.Message)"
    }
  }
}

$installRoots = @(
  'HKCU:\Software\app.clawclaw.desktop',
  'HKLM:\Software\app.clawclaw.desktop',
  'HKLM:\Software\WOW6432Node\app.clawclaw.desktop'
)

foreach ($root in $installRoots) {
  Remove-RegistryTree $root
}

$shortcutPaths = @(
  (Join-ExistingBasePath ([Environment]::GetFolderPath('Desktop')) 'ClawClaw.lnk'),
  (Join-ExistingBasePath ([Environment]::GetFolderPath('Programs')) 'ClawClaw.lnk'),
  (Join-ExistingBasePath ([Environment]::GetFolderPath('Programs')) 'ClawClaw'),
  (Join-ExistingBasePath ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'ClawClaw.lnk'),
  (Join-ExistingBasePath ([Environment]::GetFolderPath('CommonPrograms')) 'ClawClaw.lnk'),
  (Join-ExistingBasePath ([Environment]::GetFolderPath('CommonPrograms')) 'ClawClaw')
)

foreach ($path in $shortcutPaths) {
  Remove-PathIfExists $path
}

Write-Host 'ClawClaw stale Windows uninstall entries cleanup completed.'
