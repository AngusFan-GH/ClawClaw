param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir
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

function Test-ExclusiveOpen([string]$PathValue) {
  try {
    $stream = [System.IO.File]::Open(
      $PathValue,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      [System.IO.FileShare]::None
    )
    $stream.Dispose()
    return $false
  } catch {
    $exception = $_.Exception
    while ($exception -and $exception.InnerException) {
      $exception = $exception.InnerException
    }

    if ($exception -is [System.UnauthorizedAccessException]) {
      return $false
    }

    if ($exception -is [System.IO.IOException]) {
      switch ($exception.HResult) {
        -2147024864 { return $true } # ERROR_SHARING_VIOLATION
        -2147024863 { return $true } # ERROR_LOCK_VIOLATION
      }
    }

    return $false
  }
}

function Get-RelativePath([string]$BasePath, [string]$TargetPath) {
  try {
    $baseUri = [System.Uri](([System.IO.Path]::GetFullPath($BasePath).TrimEnd('\')) + '\')
    $targetUri = [System.Uri]([System.IO.Path]::GetFullPath($TargetPath))
    $relativeUri = $baseUri.MakeRelativeUri($targetUri)
    return [System.Uri]::UnescapeDataString($relativeUri.ToString()).Replace('/', '\')
  } catch {
    return $TargetPath
  }
}

$normalizedInstallDir = Normalize-PathValue $InstallDir
if ([string]::IsNullOrWhiteSpace($normalizedInstallDir)) {
  exit 0
}

$trackedPaths = @(
  (Join-Path $normalizedInstallDir 'ClawClaw.exe'),
  (Join-Path $normalizedInstallDir 'Uninstall ClawClaw.exe'),
  (Join-Path $normalizedInstallDir 'resources\bin\node.exe'),
  (Join-Path $normalizedInstallDir 'resources\bin\uv.exe'),
  (Join-Path $normalizedInstallDir 'resources\openclaw\package.json'),
  (Join-Path $normalizedInstallDir 'resources\app.asar')
) | Where-Object { Test-Path $_ }

$lockedPaths = @()
foreach ($path in $trackedPaths) {
  if (Test-ExclusiveOpen $path) {
    $lockedPaths += (Get-RelativePath $normalizedInstallDir $path)
  }
}

if ($lockedPaths.Count -gt 0) {
  Write-Output ($lockedPaths -join '; ')
  exit 2
}

exit 0
