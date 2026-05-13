import type { IncomingMessage, ServerResponse } from 'http';
import { app, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, normalize } from 'node:path';
import { applyProxySettings } from '../../main/proxy';
import { listAgentsSnapshot } from '../../utils/agent-config';
import { getOpenClawCliSpawnConfig } from '../../utils/openclaw-cli';
import { getDataDir, getDefaultExportDir, getLogsDir, getOpenClawConfigDir, expandPath } from '../../utils/paths';
import {
  getAllSettings,
  getSetting,
  resetSettings,
  setSetting,
  buildBackupPayload,
  applyBackupPayload,
  createAutoBackup,
  type AppSettings,
  type BackupPayload,
} from '../../utils/store';
import { syncMemorySettingsToOpenClaw, syncModelRuntimeSettingsToOpenClaw } from '../../utils/openclaw-auth';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

type CleanupDataRequest = {
  removeClawClawData?: boolean;
  removeLogs?: boolean;
  removeOpenClawData?: boolean;
  removeWorkspace?: boolean;
  removeGatewayService?: boolean;
};

type CleanupFailure = {
  path: string;
  error: string;
};

type CleanupSkip = {
  path: string;
  reason: string;
};

type CleanupDataResult = {
  success: boolean;
  stoppedGateway: boolean;
  gatewayActions: string[];
  removed: string[];
  missing: string[];
  skipped: CleanupSkip[];
  failed: CleanupFailure[];
  deferred?: DeferredCleanupStatus;
};

const OPENCLAW_CONFIG_DIR = getOpenClawConfigDir();
const CLEANUP_JOBS_DIR = join(app.getPath('temp'), 'clawclaw-cleanup-jobs');

type DeferredCleanupJobPayload = {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  pidToWait: number;
  paths: string[];
  removed: string[];
  failed: CleanupFailure[];
};

type DeferredCleanupStatus = {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  paths: string[];
  removed: string[];
  failed: CleanupFailure[];
};

function pathExists(path: string): Promise<boolean> {
  return access(path, constants.F_OK).then(() => true).catch(() => false);
}

function normalizePathForCompare(path: string): string {
  const normalized = normalize(path).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function patchTouchesMemory(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'sessionMemoryEnabled')
    || Object.prototype.hasOwnProperty.call(patch, 'memorySearchEnabled')
    || Object.prototype.hasOwnProperty.call(patch, 'dreamingEnabled')
    || Object.prototype.hasOwnProperty.call(patch, 'localModelLean');
}

async function applyRuntimeSettingsSideEffects(
  ctx: HostApiContext,
  options: {
    source: string;
    proxyChanged?: boolean;
    memoryChanged?: boolean;
  },
): Promise<void> {
  const proxyChanged = options.proxyChanged === true;
  const memoryChanged = options.memoryChanged === true;
  if (!proxyChanged && !memoryChanged) {
    return;
  }

  const settings = await getAllSettings();

  if (proxyChanged) {
    await applyProxySettings(settings);
  }

  if (memoryChanged) {
    await syncMemorySettingsToOpenClaw({
      sessionMemoryEnabled: settings.sessionMemoryEnabled,
      memorySearchEnabled: settings.memorySearchEnabled,
      dreamingEnabled: settings.dreamingEnabled,
    });
    await syncModelRuntimeSettingsToOpenClaw({
      localModelLean: settings.localModelLean,
    });
  }

  ctx.gatewayApplyCoordinator.enqueue({
    source: options.source,
    reason: options.source,
    requires: 'restart_immediate',
    skipIfStopped: true,
  });
}

function isPathWithin(root: string, target: string): boolean {
  const normalizedRoot = normalizePathForCompare(root);
  const normalizedTarget = normalizePathForCompare(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${process.platform === 'win32' ? '\\' : '/'}`);
}

async function removePath(
  targetPath: string,
  result: CleanupDataResult,
): Promise<void> {
  if (!(await pathExists(targetPath))) {
    result.missing.push(targetPath);
    return;
  }

  try {
    await rm(targetPath, { recursive: true, force: true });
    result.removed.push(targetPath);
  } catch (error) {
    result.failed.push({ path: targetPath, error: String(error) });
  }
}

async function clearDirectoryContents(
  directoryPath: string,
  result: CleanupDataResult,
  options?: { excludeBasenames?: Set<string> },
): Promise<void> {
  if (!(await pathExists(directoryPath))) {
    result.missing.push(directoryPath);
    return;
  }

  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    if (entries.length === 0) {
      result.missing.push(directoryPath);
      return;
    }

    for (const entry of entries) {
      const targetPath = join(directoryPath, entry.name);
      if (options?.excludeBasenames?.has(entry.name)) {
        result.skipped.push({ path: targetPath, reason: 'excluded-from-cleanup' });
        continue;
      }
      await removePath(targetPath, result);
    }
  } catch (error) {
    result.failed.push({ path: directoryPath, error: String(error) });
  }
}

function getCleanupHelperScriptPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'scripts', 'cleanup-after-exit.ps1');
  }
  return join(app.getAppPath(), 'resources', 'scripts', 'cleanup-after-exit.ps1');
}

async function ensureCleanupJobsDir(): Promise<void> {
  await mkdir(CLEANUP_JOBS_DIR, { recursive: true });
}

function toDeferredCleanupStatus(payload: DeferredCleanupJobPayload): DeferredCleanupStatus {
  return {
    jobId: payload.jobId,
    status: payload.status,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    paths: payload.paths,
    removed: payload.removed,
    failed: payload.failed,
  };
}

async function writeCleanupJob(jobFile: string, payload: DeferredCleanupJobPayload): Promise<void> {
  await writeFile(jobFile, JSON.stringify(payload, null, 2), 'utf-8');
}

async function readCleanupJob(jobFile: string): Promise<DeferredCleanupJobPayload | null> {
  try {
    const content = await readFile(jobFile, 'utf-8');
    return JSON.parse(content) as DeferredCleanupJobPayload;
  } catch {
    return null;
  }
}

async function getLatestDeferredCleanupStatus(): Promise<DeferredCleanupStatus | null> {
  try {
    await ensureCleanupJobsDir();
    const entries = await readdir(CLEANUP_JOBS_DIR);
    const jobFiles = entries.filter((entry) => entry.endsWith('.json'));
    if (jobFiles.length === 0) return null;

    const withStats = await Promise.all(
      jobFiles.map(async (entry) => ({
        file: join(CLEANUP_JOBS_DIR, entry),
        stat: await stat(join(CLEANUP_JOBS_DIR, entry)),
      })),
    );

    withStats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    const latest = await readCleanupJob(withStats[0].file);
    return latest ? toDeferredCleanupStatus(latest) : null;
  } catch {
    return null;
  }
}

async function collectDeferredClawClawPaths(request: CleanupDataRequest): Promise<string[]> {
  const paths = new Set<string>();
  const dataDir = getDataDir();
  const logsDir = getLogsDir();

  if (request.removeClawClawData) {
    await mkdir(dataDir, { recursive: true });
    try {
      const entries = await readdir(dataDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!request.removeLogs && entry.name === 'logs') {
          continue;
        }
        paths.add(join(dataDir, entry.name));
      }
    } catch {
      // ignore enumeration failure; helper will surface missing paths if needed
    }
  } else if (request.removeLogs) {
    paths.add(logsDir);
  }

  return [...paths];
}

async function queueDeferredWindowsCleanup(paths: string[]): Promise<DeferredCleanupStatus> {
  await ensureCleanupJobsDir();
  const jobId = `cleanup-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const jobFile = join(CLEANUP_JOBS_DIR, `${jobId}.json`);
  const now = new Date().toISOString();
  const payload: DeferredCleanupJobPayload = {
    jobId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    pidToWait: process.pid,
    paths,
    removed: [],
    failed: [],
  };

  await writeCleanupJob(jobFile, payload);

  const helperScript = getCleanupHelperScriptPath();
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperScript,
      '-JobFile',
      jobFile,
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  child.unref();

  return toDeferredCleanupStatus(payload);
}

async function runOpenClawCli(args: string[]): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}> {
  const spawnConfig = getOpenClawCliSpawnConfig(args);

  return await new Promise((resolve) => {
    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd,
      env: spawnConfig.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        stdout,
        stderr,
        error: String(error),
      });
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        error: code === 0 ? undefined : stderr.trim() || `openclaw exited with code ${code}`,
      });
    });
  });
}

async function collectManagedWorkspaceDirs(result: CleanupDataResult): Promise<string[]> {
  const managedDirs = new Set<string>();

  try {
    const snapshot = await listAgentsSnapshot();
    for (const agent of snapshot.agents) {
      const expanded = expandPath(agent.workspace);
      const normalizedExpanded = normalizePathForCompare(expanded);
      const basename = normalizedExpanded.split(/[\\/]/).pop() || '';

      if (isPathWithin(OPENCLAW_CONFIG_DIR, expanded) && basename.startsWith('workspace')) {
        managedDirs.add(expanded);
      } else {
        result.skipped.push({
          path: expanded,
          reason: 'external-workspace-not-managed',
        });
      }
    }
  } catch (error) {
    result.failed.push({
      path: OPENCLAW_CONFIG_DIR,
      error: `Failed to inspect configured workspaces: ${String(error)}`,
    });
  }

  try {
    const entries = await readdir(OPENCLAW_CONFIG_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('workspace')) {
        managedDirs.add(join(OPENCLAW_CONFIG_DIR, entry.name));
      }
    }
  } catch {
    // ignore missing ~/.openclaw during discovery
  }

  return [...managedDirs];
}

async function performCleanup(
  request: CleanupDataRequest,
  ctx: HostApiContext,
): Promise<CleanupDataResult> {
  const result: CleanupDataResult = {
    success: true,
    stoppedGateway: false,
    gatewayActions: [],
    removed: [],
    missing: [],
    skipped: [],
    failed: [],
  };

  let deferredPaths: string[] = [];
  const shouldQueueDeferredCleanup = process.platform === 'win32'
    && (request.removeClawClawData || request.removeLogs);

  const needsGatewayStop = Boolean(
    request.removeClawClawData ||
    request.removeLogs ||
    request.removeOpenClawData ||
    request.removeWorkspace ||
    request.removeGatewayService
  );

  if (needsGatewayStop) {
    try {
      await ctx.gatewayManager.stop();
      result.stoppedGateway = true;
      result.gatewayActions.push('gateway-manager-stop');
    } catch (error) {
      result.failed.push({
        path: 'gateway-manager-stop',
        error: String(error),
      });
    }
  }

  if (request.removeGatewayService) {
    const stopResult = await runOpenClawCli(['gateway', 'stop']);
    if (stopResult.success) {
      result.gatewayActions.push('openclaw gateway stop');
    } else {
      result.failed.push({
        path: 'openclaw gateway stop',
        error: stopResult.error || 'unknown-error',
      });
    }

    const uninstallResult = await runOpenClawCli(['gateway', 'uninstall']);
    if (uninstallResult.success) {
      result.gatewayActions.push('openclaw gateway uninstall');
    } else {
      result.failed.push({
        path: 'openclaw gateway uninstall',
        error: uninstallResult.error || 'unknown-error',
      });
    }
  }

  if (shouldQueueDeferredCleanup) {
    deferredPaths = await collectDeferredClawClawPaths(request);
    if (deferredPaths.length === 0) {
      result.missing.push(request.removeClawClawData ? getDataDir() : getLogsDir());
    }
  } else if (request.removeClawClawData) {
    try {
      await resetSettings();
    } catch (error) {
      result.failed.push({
        path: join(getDataDir(), 'settings.json'),
        error: `Failed to reset settings: ${String(error)}`,
      });
    }

    const excluded = new Set<string>();
    if (!request.removeLogs) {
      excluded.add('logs');
    }
    await mkdir(getDataDir(), { recursive: true });
    await clearDirectoryContents(getDataDir(), result, { excludeBasenames: excluded });
  }

  if (request.removeLogs && !request.removeClawClawData) {
    await removePath(getLogsDir(), result);
  }

  if (request.removeOpenClawData) {
    await removePath(OPENCLAW_CONFIG_DIR, result);
  } else if (request.removeWorkspace) {
    const workspaceDirs = await collectManagedWorkspaceDirs(result);
    if (workspaceDirs.length === 0) {
      result.missing.push(join(OPENCLAW_CONFIG_DIR, 'workspace*'));
    }
    for (const workspaceDir of workspaceDirs) {
      await removePath(workspaceDir, result);
    }
  }

  if (shouldQueueDeferredCleanup && deferredPaths.length > 0) {
    try {
      result.deferred = await queueDeferredWindowsCleanup(deferredPaths);
    } catch (error) {
      result.failed.push({
        path: 'deferred-cleanup',
        error: `Failed to queue deferred cleanup: ${String(error)}`,
      });
    }
  }

  result.success = result.failed.length === 0;
  return result;
}

function patchTouchesProxy(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => (
    key === 'proxyMode' ||
    key === 'proxyEnabled' ||
    key === 'proxyServer' ||
    key === 'proxyHttpServer' ||
    key === 'proxyHttpsServer' ||
    key === 'proxyAllServer' ||
    key === 'proxyBypassRules'
  ));
}

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    sendJson(res, 200, await getAllSettings());
    return true;
  }

  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    try {
      const patch = await parseJsonBody<Partial<AppSettings>>(req);
      const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
      for (const [key, value] of entries) {
        await setSetting(key, value);
      }
      const proxyChanged = patchTouchesProxy(patch);
      const memoryChanged = patchTouchesMemory(patch);
      await applyRuntimeSettingsSideEffects(ctx, {
        source: proxyChanged && memoryChanged
          ? 'settings.update'
          : proxyChanged
            ? 'settings.proxy'
            : 'settings.memory',
        proxyChanged,
        memoryChanged,
      });
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'GET') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      sendJson(res, 200, { value: await getSetting(key) });
    } catch (error) {
      sendJson(res, 404, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'PUT') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      const body = await parseJsonBody<{ value: AppSettings[keyof AppSettings] }>(req);
      await setSetting(key, body.value);
      const proxyChanged =
        key === 'proxyEnabled' ||
        key === 'proxyMode' ||
        key === 'proxyServer' ||
        key === 'proxyHttpServer' ||
        key === 'proxyHttpsServer' ||
        key === 'proxyAllServer' ||
        key === 'proxyBypassRules';
      const memoryChanged = key === 'sessionMemoryEnabled'
        || key === 'memorySearchEnabled'
        || key === 'dreamingEnabled'
        || key === 'localModelLean';
      await applyRuntimeSettingsSideEffects(ctx, {
        source: proxyChanged
          ? 'settings.proxy'
          : memoryChanged
            ? 'settings.memory'
            : 'settings.update',
        proxyChanged,
        memoryChanged,
      });
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/reset' && req.method === 'POST') {
    try {
      // Auto-backup before destructive reset
      const autoBackupPath = await createAutoBackup('pre-reset');
      await resetSettings();
      await applyRuntimeSettingsSideEffects(ctx, {
        source: 'settings.reset',
        proxyChanged: true,
        memoryChanged: true,
      });
      sendJson(res, 200, {
        success: true,
        settings: await getAllSettings(),
        autoBackupPath,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/export-config' && req.method === 'POST') {
    try {
      const payload = await buildBackupPayload();
      const exportedAt = payload.metadata.exportedAt;
      const defaultFileName = `clawclaw-backup-${exportedAt.slice(0, 10)}.json`;
      const exportDir = getDefaultExportDir('settings');
      await mkdir(exportDir, { recursive: true });
      const result = await dialog.showSaveDialog({
        title: 'Export ClawClaw backup',
        defaultPath: join(exportDir, defaultFileName),
        filters: [
          { name: 'JSON', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        sendJson(res, 200, { success: false, cancelled: true });
        return true;
      }

      await writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
      sendJson(res, 200, {
        success: true,
        savedPath: result.filePath,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // POST /api/settings/import-config — open file picker, validate, return preview
  if (url.pathname === '/api/settings/import-config' && req.method === 'POST') {
    try {
      const openResult = await dialog.showOpenDialog({
        title: 'Import ClawClaw backup',
        defaultPath: getDefaultExportDir('settings'),
        filters: [
          { name: 'JSON', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (openResult.canceled || !openResult.filePaths[0]) {
        sendJson(res, 200, { success: false, cancelled: true });
        return true;
      }

      const filePath = openResult.filePaths[0];
      const raw = await readFile(filePath, 'utf-8');
      let parsed: BackupPayload;
      try {
        parsed = JSON.parse(raw) as BackupPayload;
      } catch {
        sendJson(res, 400, { success: false, error: 'Invalid JSON file' });
        return true;
      }

      // Basic validation
      if (!parsed?.metadata || !parsed?.settings || !parsed?.openclawConfig) {
        sendJson(res, 400, { success: false, error: 'This file is not a valid ClawClaw backup' });
        return true;
      }

      sendJson(res, 200, {
        success: true,
        preview: {
          appVersion: parsed.metadata.appVersion,
          exportedAt: parsed.metadata.exportedAt,
          backupId: parsed.metadata.backupId,
          hasOpenClawConfig: Object.keys(parsed.openclawConfig).length > 0,
          providerCount: parsed.providerMeta?.length ?? 0,
        },
        // Return full payload so renderer can forward it to apply-import
        payload: parsed,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // POST /api/settings/apply-import — actually apply a previously selected backup
  if (url.pathname === '/api/settings/apply-import' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        payload: BackupPayload;
        skipApiKeyWarning?: boolean;
        createAutoBackup?: boolean;
      }>(req);

      if (!body?.payload) {
        sendJson(res, 400, { success: false, error: 'Missing backup payload' });
        return true;
      }

      // Auto-backup current state before overwriting
      let autoBackupPath: string | null = null;
      if (body.createAutoBackup !== false) {
        autoBackupPath = await createAutoBackup('pre-import');
      }

      const result = await applyBackupPayload(body.payload, {
        skipApiKeyWarning: body.skipApiKeyWarning,
      });

      sendJson(res, 200, {
        ...result,
        autoBackupPath,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/cleanup-data' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<CleanupDataRequest>(req);
      if (
        !body.removeClawClawData &&
        !body.removeLogs &&
        !body.removeOpenClawData &&
        !body.removeWorkspace &&
        !body.removeGatewayService
      ) {
        sendJson(res, 400, { success: false, error: 'No cleanup scope selected' });
        return true;
      }

      const cleanup = await performCleanup(body, ctx);
      sendJson(res, 200, cleanup);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/cleanup-status' && req.method === 'GET') {
    try {
      const status = await getLatestDeferredCleanupStatus();
      sendJson(res, 200, {
        success: true,
        status,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
