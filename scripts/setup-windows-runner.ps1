# Run as the same Windows user that successfully built ClawClaw.
param(
    [string]$RunnerRoot = 'D:\Angus\Work\Projects\ClawClaw\Runner',
    [string]$GitLabUrl = 'https://gitlab.xzinfra.com'
)
$ErrorActionPreference = 'Stop'
foreach ($tool in @('git', 'node', 'corepack')) {
    Get-Command $tool -ErrorAction Stop | Out-Null
}
if ((node -p 'process.arch') -ne 'x64') { throw 'Windows packaging requires x64 Node.js.' }
if ($LASTEXITCODE -ne 0) { throw 'Node.js preflight failed.' }

$RunnerVersion = '16.9.1' # Match the current GitLab 16.9 server family.
$ExpectedHash = '76e30bedb7aac913ad3d4b03c9abb95f2a8c30ff63101b9f27894a1648bba569'
$Binary = Join-Path $RunnerRoot 'gitlab-runner.exe'
$Config = Join-Path $RunnerRoot 'config.toml'
if (Test-Path $Config) { throw "Runner already configured: $Config. Do not register a duplicate." }
New-Item -ItemType Directory -Force $RunnerRoot | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing -Uri "https://gitlab-runner-downloads.s3.amazonaws.com/v$RunnerVersion/binaries/gitlab-runner-windows-amd64.exe" -OutFile "$Binary.download"
if ((Get-FileHash "$Binary.download" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash) {
    Remove-Item "$Binary.download"
    throw 'Official Runner binary SHA-256 mismatch.'
}
Move-Item -Force "$Binary.download" $Binary

Write-Host 'Create a project Runner in GitLab with tag clawclaw-windows; disable untagged jobs.'
$SecureToken = Read-Host 'Paste the Runner authentication token (glrt-...)' -AsSecureString
$Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
    $env:CI_SERVER_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
    & $Binary register --non-interactive --config $Config --url $GitLabUrl `
        --executor shell --shell powershell --name 'ClawClaw Windows office runner' `
        --builds-dir (Join-Path $RunnerRoot 'builds') --cache-dir (Join-Path $RunnerRoot 'cache')
    if ($LASTEXITCODE -ne 0) { throw 'Runner registration failed.' }
} finally {
    Remove-Item Env:\CI_SERVER_TOKEN -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
    $SecureToken.Dispose()
}

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $Config /inheritance:r /grant:r "${Identity}:(F)" 'SYSTEM:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict Runner configuration permissions.' }

# Start in the validated user's login environment, without storing a Windows password.
$Startup = [Environment]::GetFolderPath('Startup')
$Shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $Startup 'ClawClaw Runner.lnk'))
$Shortcut.TargetPath = $Binary
$Shortcut.Arguments = "run --config `"$Config`" --working-directory `"$RunnerRoot`""
$Shortcut.WorkingDirectory = $RunnerRoot
$Shortcut.WindowStyle = 7
$Shortcut.Save()
Start-Process -FilePath $Binary -ArgumentList $Shortcut.Arguments -WorkingDirectory $RunnerRoot
Write-Host 'Runner registered and started. It starts again when this Windows user signs in.'
Write-Host 'Keep its window running and prevent sleep until the complete pipeline succeeds.'
