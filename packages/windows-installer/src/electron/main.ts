import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInstallPlan, createUninstallPlan } from '../core/plan.js';
import { parseInstallerManifest } from '../core/manifest.js';
import { executeInstallerPlan } from '../core/executor.js';
import type { ExistingInstallState } from '../core/types.js';
import type { InstallerInitialState, InstallerPlanRequest, InstallerPlanResponse } from '../shared/ipc.js';

const isDev = Boolean(process.env.WINDOWS_INSTALLER_DEV_SERVER_URL);
const currentDir = fileURLToPath(new URL('.', import.meta.url));

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 660,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'ClawClaw Setup',
    backgroundColor: '#eef1f5',
    webPreferences: {
      preload: join(currentDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    void win.loadURL(process.env.WINDOWS_INSTALLER_DEV_SERVER_URL!);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(resolveInstallerUiPath());
  }

  return win;
}

function registerIpc(): void {
  ipcMain.handle('installer:getInitialState', async (): Promise<InstallerInitialState> => {
    return resolveInitialState();
  });

  ipcMain.handle('installer:getPlan', async (_, request: InstallerPlanRequest): Promise<InstallerPlanResponse> => {
    try {
      return { ok: true, plan: buildPlan(request) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('installer:start', async (event, request: InstallerPlanRequest & { execute?: boolean }) => {
    try {
      const manifestPath = resolveInstallerManifestPath();
      const manifest = parseInstallerManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
      const payload = manifest.payloads.find((candidate) => candidate.arch === request.arch)
        ?? manifest.payloads[0];
      const plan = buildPlan(request);
      await executeInstallerPlan(plan, {
        execute: request.execute === true,
        installDir: request.installDir,
        manifestPath,
        manifest,
        payload,
        removeClawClawData: request.removeClawClawData,
        removeOpenClawData: request.removeOpenClawData,
        removeLogsAndCache: request.removeLogsAndCache,
        createDesktopShortcut: request.createDesktopShortcut,
        launchAtStartup: request.launchAtStartup,
        installCliPath: request.installCliPath,
        onEvent: (payloadEvent) => {
          event.sender.send('installer:progress', payloadEvent);
        },
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      event.sender.send('installer:progress', { type: 'step:error', message });
      return { ok: false, error: message };
    }
  });
}

function resolveInitialState(): InstallerInitialState {
  const explicitUninstall = process.argv.some((arg) => (
    arg === '--uninstall' || arg === '--maintenance' || arg === '--remove'
  ));
  const legacyInstall = readLegacyInstallState();
  const mode = explicitUninstall ? 'uninstall' : legacyInstall.detected ? 'upgrade' : 'install';
  return {
    mode,
    installDir: legacyInstall.installDir || '%LOCALAPPDATA%\\Programs\\ClawClaw',
    arch: process.arch === 'arm64' ? 'arm64' : 'x64',
    legacyVersion: legacyInstall.version,
    detectedExistingInstall: legacyInstall.detected,
  };
}

function readLegacyInstallState(): { detected: boolean; installDir?: string; version?: string } {
  if (process.platform !== 'win32') {
    return { detected: false };
  }

  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ClawClaw';
  const result = spawnSync('reg.exe', ['query', key], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  if ((result.status ?? 1) !== 0 || !result.stdout) {
    return { detected: false };
  }

  return {
    detected: true,
    installDir: parseRegValue(result.stdout, 'InstallLocation'),
    version: parseRegValue(result.stdout, 'DisplayVersion'),
  };
}

function parseRegValue(output: string, name: string): string | undefined {
  const line = output.split(/\r?\n/).find((entry) => entry.trim().startsWith(name));
  if (!line) return undefined;
  const match = line.match(/^\s*\S+\s+REG_\S+\s+(.+?)\s*$/);
  return match?.[1]?.trim() || undefined;
}

function buildPlan(request: InstallerPlanRequest) {
  const existingInstall: ExistingInstallState = {
    detected: request.mode !== 'install',
    version: request.legacyVersion,
    installDir: request.mode === 'install' ? undefined : request.installDir,
    source: request.mode === 'install' ? 'none' : 'legacy-nsis',
    requiresLegacyRuntimeCleanup: Boolean(
      request.legacyVersion && compareVersion(request.legacyVersion, '0.1.15') <= 0,
    ),
  };

  return request.mode === 'uninstall'
    ? createUninstallPlan({
      mode: 'uninstall',
      existingInstall,
      removeClawClawData: request.removeClawClawData,
      removeOpenClawData: request.removeOpenClawData,
      removeLogsAndCache: request.removeLogsAndCache,
    })
    : createInstallPlan({
      mode: request.mode,
      installDir: request.installDir,
      createDesktopShortcut: request.createDesktopShortcut,
      launchAtStartup: request.launchAtStartup,
      installCliPath: request.installCliPath,
      existingInstall,
    });
}

function resolveInstallerManifestPath(): string {
  const candidates = [
    resolve(process.resourcesPath, 'manifest.json'),
    resolve(currentDir, '..', '..', 'manifest.json'),
    resolve(process.cwd(), 'release', 'windows-installer', 'manifest.json'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Installer manifest not found. Checked: ${candidates.join(', ')}`);
  }
  return found;
}

function resolveInstallerUiPath(): string {
  const candidates = [
    resolve(process.resourcesPath, 'ui', 'index.html'),
    resolve(currentDir, '..', '..', 'ui', 'index.html'),
    resolve(currentDir, '..', '..', 'dist', 'index.html'),
    resolve(process.cwd(), 'release', 'windows-installer', 'ui', 'index.html'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Installer UI not found. Checked: ${candidates.join(', ')}`);
  }
  return found;
}

function compareVersion(left: string, right: string): number {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
