import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { InstallerManifest, InstallerPayload } from './manifest.js';
import type { InstallerPlan, InstallerStepPlan } from './types.js';

export interface ExecutorOptions {
  execute: boolean;
  installDir: string;
  manifestPath: string;
  manifest: InstallerManifest;
  payload: InstallerPayload;
  removeClawClawData?: boolean;
  removeOpenClawData?: boolean;
  removeLogsAndCache?: boolean;
  createDesktopShortcut?: boolean;
  launchAtStartup?: boolean;
  installCliPath?: boolean;
  onEvent?: (event: ExecutorEvent) => void;
}

export interface ExecutorEvent {
  type: 'start' | 'step:start' | 'step:done' | 'step:error' | 'done' | 'log';
  stepId?: string;
  title?: string;
  message?: string;
}

export interface ExecutorResult {
  executed: boolean;
  steps: number;
}

export async function executeInstallerPlan(
  plan: InstallerPlan,
  options: ExecutorOptions,
): Promise<ExecutorResult> {
  emit(options, { type: 'start', message: options.execute ? 'Starting installer execution' : 'Dry run only' });

  if (options.execute && process.platform !== 'win32') {
    throw new Error('Real installer execution is only supported on Windows');
  }

  for (const step of plan.steps) {
    emit(options, { type: 'step:start', stepId: step.id, title: step.title });
    try {
      if (options.execute) {
        await executeStep(step, plan, options);
      }
      emit(options, { type: 'step:done', stepId: step.id, title: step.title });
    } catch (error) {
      emit(options, {
        type: 'step:error',
        stepId: step.id,
        title: step.title,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  emit(options, { type: 'done', message: options.execute ? 'Execution completed' : 'Dry run completed' });
  return { executed: options.execute, steps: plan.steps.length };
}

async function executeStep(
  step: InstallerStepPlan,
  plan: InstallerPlan,
  options: ExecutorOptions,
): Promise<void> {
  switch (step.kind) {
    case 'detect-existing-install':
      return;
    case 'stop-running-processes':
      killInstallDirProcesses(options.installDir);
      return;
    case 'stop-gateway':
      runGatewayCommand(options.installDir, 'gateway stop', false);
      return;
    case 'remove-gateway-service':
      runGatewayCommand(options.installDir, 'gateway uninstall', false);
      return;
    case 'clean-stale-runtime':
      cleanStaleRuntime(options.installDir);
      return;
    case 'copy-payload':
      copyPayload(options);
      return;
    case 'write-registry':
      if (plan.mode === 'uninstall') {
        removeRegistry();
      } else {
        writeRegistry(options);
      }
      return;
    case 'create-shortcuts':
      if (plan.mode === 'uninstall') {
        removeShortcuts();
      } else {
        createShortcuts(options);
      }
      return;
    case 'update-path':
      if (plan.mode === 'uninstall') {
        updateUserPath(join(options.installDir, 'resources', 'cli'), 'remove');
      } else {
        updateUserPath(join(options.installDir, 'resources', 'cli'), 'add');
      }
      return;
    case 'remove-app-files':
      removeShortcuts();
      updateUserPath(join(options.installDir, 'resources', 'cli'), 'remove');
      removeRegistry();
      rmSync(expandPath(options.installDir), { recursive: true, force: true });
      return;
    case 'remove-user-data':
      removeSelectedUserData(step.id, options);
      return;
    case 'finalize':
      if (plan.mode !== 'uninstall' && options.launchAtStartup) {
        setLaunchAtStartup(options);
      }
      return;
    default:
      return;
  }
}

function copyPayload(options: ExecutorOptions): void {
  const manifestDir = dirname(resolve(options.manifestPath));
  const payloadDir = resolve(manifestDir, '..', options.payload.unpackedDir);
  if (!existsSync(payloadDir)) {
    throw new Error(`Windows payload directory not found: ${payloadDir}`);
  }
  const installDir = expandPath(options.installDir);
  mkdirSync(installDir, { recursive: true });
  cpSync(payloadDir, installDir, { recursive: true, force: true });
}

function cleanStaleRuntime(installDir: string): void {
  const root = expandPath(installDir);
  for (const relative of [
    'resources/openclaw',
    'resources/openclaw-plugins',
    'resources/bin',
    'resources/cli',
  ]) {
    rmSync(join(root, relative), { recursive: true, force: true });
  }
}

function killInstallDirProcesses(installDir: string): void {
  const script = `
$target = [System.IO.Path]::GetFullPath('${escapePowerShell(expandPath(installDir))}').TrimEnd('\\')
$escaped = [Regex]::Escape($target)
$names = @('ClawClaw.exe', 'node.exe', 'uv.exe')
Get-CimInstance Win32_Process | Where-Object {
  if ($_.ProcessId -eq $PID) { return $false }
  $path = $_.ExecutablePath
  if ($path) {
    try {
      $full = [System.IO.Path]::GetFullPath($path).TrimEnd('\\')
      if ($full.StartsWith($target, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    } catch {}
  }
  return $_.CommandLine -and $_.CommandLine -match $escaped -and $names -contains $_.Name
} | ForEach-Object {
  try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {}
}
Start-Sleep -Seconds 2
`;
  runPowerShell(script, false);
}

function runGatewayCommand(installDir: string, command: 'gateway stop' | 'gateway uninstall', required: boolean): void {
  const root = expandPath(installDir);
  const nodeExe = join(root, 'resources', 'bin', 'node.exe');
  const openclawDir = join(root, 'resources', 'openclaw');
  const entry = join(openclawDir, 'openclaw.mjs');
  if (!existsSync(nodeExe) || !existsSync(entry)) {
    if (required) throw new Error('Bundled OpenClaw runtime is missing');
    return;
  }
  const args = ['--disable-warning=ExperimentalWarning', entry, ...command.split(' ')];
  spawnSync(nodeExe, args, {
    cwd: openclawDir,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, OPENCLAW_EMBEDDED_IN: 'ClawClaw' },
  });
}

function writeRegistry(options: ExecutorOptions): void {
  const installDir = expandPath(options.installDir);
  const exePath = join(installDir, 'ClawClaw.exe');
  const uninstallCommand = `"${exePath}" --maintenance`;
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ClawClaw';
  regAdd(key, 'DisplayName', 'REG_SZ', options.manifest.displayName);
  regAdd(key, 'DisplayVersion', 'REG_SZ', options.manifest.version);
  regAdd(key, 'Publisher', 'REG_SZ', 'ClawClaw Team');
  regAdd(key, 'InstallLocation', 'REG_SZ', installDir);
  regAdd(key, 'DisplayIcon', 'REG_SZ', exePath);
  regAdd(key, 'UninstallString', 'REG_SZ', uninstallCommand);
  regAdd(key, 'QuietUninstallString', 'REG_SZ', `${uninstallCommand} --silent`);
  regAdd(key, 'NoModify', 'REG_DWORD', '1');
  regAdd(key, 'NoRepair', 'REG_DWORD', '1');
}

function removeRegistry(): void {
  spawnSync('reg.exe', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ClawClaw', '/f'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function regAdd(key: string, name: string, type: string, value: string): void {
  const result = spawnSync('reg.exe', ['add', key, '/v', name, '/t', type, '/d', value, '/f'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || `Failed to write registry value ${name}`);
  }
}

function createShortcuts(options: ExecutorOptions): void {
  const installDir = expandPath(options.installDir);
  const exePath = join(installDir, 'ClawClaw.exe');
  const startMenuDir = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ClawClaw');
  mkdirSync(startMenuDir, { recursive: true });
  createShortcut(join(startMenuDir, 'ClawClaw.lnk'), exePath, installDir);
  if (options.createDesktopShortcut !== false) {
    const desktop = join(homedir(), 'Desktop');
    createShortcut(join(desktop, 'ClawClaw.lnk'), exePath, installDir);
  }
}

function removeShortcuts(): void {
  const startMenuDir = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ClawClaw');
  rmSync(join(startMenuDir, 'ClawClaw.lnk'), { force: true });
  rmSync(startMenuDir, { recursive: true, force: true });
  rmSync(join(homedir(), 'Desktop', 'ClawClaw.lnk'), { force: true });
}

function createShortcut(shortcutPath: string, targetPath: string, workingDirectory: string): void {
  const script = `
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut('${escapePowerShell(shortcutPath)}')
$shortcut.TargetPath = '${escapePowerShell(targetPath)}'
$shortcut.WorkingDirectory = '${escapePowerShell(workingDirectory)}'
$shortcut.Save()
`;
  runPowerShell(script, true);
}

function updateUserPath(cliDir: string, action: 'add' | 'remove'): void {
  const normalized = expandPath(cliDir);
  const script = `
$cli = '${escapePowerShell(normalized)}'
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @()
if ($current) { $parts = $current -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } }
$next = @($parts | Where-Object { $_.TrimEnd('\\') -ine $cli.TrimEnd('\\') })
if ('${action}' -eq 'add' -and (Test-Path -LiteralPath $cli)) { $next = @($next + $cli) }
[Environment]::SetEnvironmentVariable('Path', ($next -join ';'), 'User')
`;
  runPowerShell(script, true);
}

function setLaunchAtStartup(options: ExecutorOptions): void {
  const exePath = join(expandPath(options.installDir), 'ClawClaw.exe');
  regAdd('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'ClawClaw', 'REG_SZ', `"${exePath}"`);
}

function removeSelectedUserData(stepId: string, options: ExecutorOptions): void {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  if (stepId === 'remove-openclaw-data' && options.removeOpenClawData) {
    rmSync(join(homedir(), '.openclaw'), { recursive: true, force: true });
    return;
  }
  if (options.removeClawClawData) {
    rmSync(join(appData, 'clawclaw'), { recursive: true, force: true });
    rmSync(join(appData, 'ClawClaw'), { recursive: true, force: true });
  }
  if (options.removeLogsAndCache || options.removeClawClawData) {
    rmSync(join(localAppData, 'clawclaw'), { recursive: true, force: true });
    rmSync(join(localAppData, 'ClawClaw'), { recursive: true, force: true });
  }
}

function runPowerShell(script: string, required: boolean): void {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (required && (result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || 'PowerShell command failed');
  }
}

function expandPath(value: string): string {
  return value.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] || `%${name}%`);
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

function emit(options: ExecutorOptions, event: ExecutorEvent): void {
  options.onEvent?.(event);
}
