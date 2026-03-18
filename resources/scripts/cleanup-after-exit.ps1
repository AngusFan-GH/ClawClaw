param(
  [Parameter(Mandatory = $true)]
  [string]$JobFile
)

$ErrorActionPreference = "Stop"

function Read-Job {
  if (-not (Test-Path -LiteralPath $JobFile)) {
    throw "Cleanup job file not found: $JobFile"
  }
  return Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json
}

function Write-Job($Job) {
  $Job.updatedAt = [DateTime]::UtcNow.ToString("o")
  $json = $Job | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($JobFile, $json, [System.Text.Encoding]::UTF8)
}

function Wait-ForProcessExit([int]$PidToWait) {
  $timeoutAt = (Get-Date).AddMinutes(5)
  while ((Get-Date) -lt $timeoutAt) {
    $proc = Get-Process -Id $PidToWait -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Remove-PathWithRetry([string]$TargetPath) {
  if (-not (Test-Path -LiteralPath $TargetPath)) {
    return @{ removed = $false; missing = $true; error = $null }
  }

  for ($attempt = 1; $attempt -le 8; $attempt++) {
    try {
      Remove-Item -LiteralPath $TargetPath -Recurse -Force -ErrorAction Stop
      return @{ removed = $true; missing = $false; error = $null }
    } catch {
      if ($attempt -eq 8) {
        return @{ removed = $false; missing = $false; error = $_.Exception.Message }
      }
      Start-Sleep -Milliseconds (400 * $attempt)
    }
  }
}

try {
  $job = Read-Job
  $job.status = "running"
  Write-Job $job

  $didExit = Wait-ForProcessExit -PidToWait ([int]$job.pidToWait)
  if (-not $didExit) {
    $job.status = "failed"
    $job.failed += @{
      path = "process:$($job.pidToWait)"
      error = "Timed out waiting for the ClawClaw process to exit."
    }
    Write-Job $job
    exit 1
  }

  foreach ($targetPath in $job.paths) {
    $result = Remove-PathWithRetry -TargetPath $targetPath
    if ($result.removed) {
      $job.removed += $targetPath
      continue
    }
    if (-not $result.missing) {
      $job.failed += @{
        path = $targetPath
        error = $result.error
      }
    }
  }

  if ($job.failed.Count -gt 0) {
    $job.status = "failed"
    Write-Job $job
    exit 1
  }

  $job.status = "completed"
  Write-Job $job
  exit 0
} catch {
  try {
    $job = Read-Job
    $job.status = "failed"
    $job.failed += @{
      path = "cleanup-helper"
      error = $_.Exception.Message
    }
    Write-Job $job
  } catch {
  }
  exit 1
}
