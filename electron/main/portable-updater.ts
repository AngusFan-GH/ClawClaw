import { app, BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { getPortableDataDir } from '../utils/paths';
import {
  getPortableManifestUrl,
  type PortableUpdateManifest,
  type UpdateChannel,
} from '../shared/update-feed';
import { markAppQuitting } from './quit';

export interface PortableProgressInfo {
  total: number;
  delta: number;
  transferred: number;
  percent: number;
  bytesPerSecond: number;
}

export interface PortableUpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | null;
  minimumAppVersion?: string;
}

export interface PortableUpdateStatus {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'migration-required'
    | 'error';
  info?: PortableUpdateInfo;
  progress?: PortableProgressInfo;
  error?: string;
}

function compareVersions(left: string, right: string): number {
  const normalize = (value: string) => value.replace(/^v/i, '').split(/[-+]/)[0].split('.').map((part) => Number(part) || 0);
  const a = normalize(left);
  const b = normalize(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }
  return 0;
}

function detectPortableTarget(): 'win32-x64' | 'win32-arm64' | 'darwin-x64' | 'darwin-arm64' | null {
  if (process.platform === 'win32' && (process.arch === 'x64' || process.arch === 'arm64')) {
    return `win32-${process.arch}` as 'win32-x64' | 'win32-arm64';
  }
  if (process.platform === 'darwin' && (process.arch === 'x64' || process.arch === 'arm64')) {
    return `darwin-${process.arch}` as 'darwin-x64' | 'darwin-arm64';
  }
  return null;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

async function sha512Base64(filePath: string): Promise<string> {
  const hash = createHash('sha512');
  const stream = (await import('node:fs')).createReadStream(filePath);
  return new Promise((resolveHash, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('base64')));
  });
}

function resolveWindowsPortableRoot(): string {
  return dirname(app.getPath('exe'));
}

function resolveMacPortableBundlePath(): string {
  return resolve(app.getPath('exe'), '..', '..', '..');
}

function resolveMacPortableRoot(): string {
  return dirname(resolveMacPortableBundlePath());
}

function resolvePortableArtifactPath(version: string, artifactUrl: string): string {
  const portableDataDir = getPortableDataDir();
  if (!portableDataDir) {
    throw new Error('Portable data directory is unavailable.');
  }
  const updatesDir = join(portableDataDir, 'cache', 'updates', version);
  ensureDir(updatesDir);
  return join(updatesDir, artifactUrl.split('/').pop() || `portable-${version}.zip`);
}

export class PortableUpdater extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private status: PortableUpdateStatus = { status: 'idle' };
  private channel: UpdateChannel = 'stable';
  private latestManifest: PortableUpdateManifest | null = null;
  private downloadedArtifactPath: string | null = null;

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  isSupported(): boolean {
    return app.isPackaged && getPortableDataDir() !== null && detectPortableTarget() !== null;
  }

  getStatus(): PortableUpdateStatus {
    return this.status;
  }

  getCurrentVersion(): string {
    return app.getVersion();
  }

  setChannel(channel: UpdateChannel): void {
    this.channel = channel;
  }

  async checkForUpdates(): Promise<PortableUpdateInfo | null> {
    if (!this.isSupported()) {
      this.updateStatus({
        status: 'error',
        error: 'Portable updates are not available in the current environment.',
      });
      return null;
    }

    const target = detectPortableTarget();
    if (!target) {
      this.updateStatus({
        status: 'error',
        error: 'Portable update target could not be determined.',
      });
      return null;
    }

    this.updateStatus({ status: 'checking', error: undefined });
    const manifestUrl = getPortableManifestUrl(this.channel, target);
    logger.info(`[PortableUpdater] checking manifest ${manifestUrl}`);

    try {
      const response = await fetch(manifestUrl, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });

      if (response.status === 404) {
        this.latestManifest = null;
        this.downloadedArtifactPath = null;
        this.updateStatus({ status: 'not-available', error: undefined });
        return null;
      }

      if (!response.ok) {
        throw new Error(`Portable update manifest request failed: ${response.status} ${response.statusText}`);
      }

      const manifest = (await response.json()) as PortableUpdateManifest;
      this.latestManifest = manifest;
      const info: PortableUpdateInfo = {
        version: manifest.version,
        releaseDate: manifest.releaseDate,
        releaseNotes: manifest.notes ?? null,
        minimumAppVersion: manifest.minimumAppVersion,
      };

      if (compareVersions(app.getVersion(), manifest.minimumAppVersion) < 0) {
        this.updateStatus({
          status: 'migration-required',
          info,
          error: `Portable in-place update requires at least v${manifest.minimumAppVersion}.`,
        });
        return info;
      }

      if (compareVersions(manifest.version, app.getVersion()) <= 0) {
        this.downloadedArtifactPath = null;
        this.updateStatus({ status: 'not-available', info, error: undefined });
        return null;
      }

      this.downloadedArtifactPath = resolvePortableArtifactPath(manifest.version, manifest.artifact.url);
      this.updateStatus({ status: 'available', info, error: undefined });
      return info;
    } catch (error) {
      logger.error('[PortableUpdater] check failed:', error);
      this.updateStatus({
        status: 'error',
        error: (error as Error).message || String(error),
      });
      throw error;
    }
  }

  async downloadUpdate(): Promise<void> {
    if (!this.latestManifest) {
      throw new Error('No portable update is available to download.');
    }

    const artifactPath = this.downloadedArtifactPath
      ?? resolvePortableArtifactPath(this.latestManifest.version, this.latestManifest.artifact.url);
    ensureDir(dirname(artifactPath));

    const response = await fetch(this.latestManifest.artifact.url, { cache: 'no-store' });
    if (!response.ok || !response.body) {
      throw new Error(`Portable update download failed: ${response.status} ${response.statusText}`);
    }

    const total = Number(response.headers.get('content-length') || this.latestManifest.artifact.size || 0);
    const startedAt = Date.now();
    let transferred = 0;
    let lastTransferred = 0;

    this.updateStatus({
      status: 'downloading',
      info: {
        version: this.latestManifest.version,
        releaseDate: this.latestManifest.releaseDate,
        releaseNotes: this.latestManifest.notes ?? null,
        minimumAppVersion: this.latestManifest.minimumAppVersion,
      },
      progress: {
        total,
        delta: 0,
        transferred: 0,
        percent: 0,
        bytesPerSecond: 0,
      },
      error: undefined,
    });

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const writer = createWriteStream(artifactPath);
      writer.on('error', rejectPromise);
      writer.on('finish', resolvePromise);

      const reader = response.body.getReader();
      const pump = (): void => {
        void reader.read().then(({ done, value }) => {
          if (done) {
            writer.end();
            return;
          }

          if (value) {
            transferred += value.byteLength;
            writer.write(Buffer.from(value));
            const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
            const delta = transferred - lastTransferred;
            lastTransferred = transferred;
            this.updateStatus({
              status: 'downloading',
              info: {
                version: this.latestManifest.version,
                releaseDate: this.latestManifest.releaseDate,
                releaseNotes: this.latestManifest.notes ?? null,
                minimumAppVersion: this.latestManifest.minimumAppVersion,
              },
              progress: {
                total,
                delta,
                transferred,
                percent: total > 0 ? (transferred / total) * 100 : 0,
                bytesPerSecond: transferred / elapsedSeconds,
              },
              error: undefined,
            });
          }

          pump();
        }).catch(rejectPromise);
      };
      pump();
    });

    const actualHash = await sha512Base64(artifactPath);
    if (actualHash !== this.latestManifest.artifact.sha512) {
      await fs.unlink(artifactPath).catch(() => undefined);
      throw new Error('Portable update checksum verification failed.');
    }

    this.downloadedArtifactPath = artifactPath;
    this.updateStatus({
      status: 'downloaded',
      info: {
        version: this.latestManifest.version,
        releaseDate: this.latestManifest.releaseDate,
        releaseNotes: this.latestManifest.notes ?? null,
        minimumAppVersion: this.latestManifest.minimumAppVersion,
      },
      progress: this.status.progress,
      error: undefined,
    });
  }

  installUpdate(): void {
    if (!this.latestManifest || !this.downloadedArtifactPath || !existsSync(this.downloadedArtifactPath)) {
      throw new Error('Portable update has not been downloaded yet.');
    }

    if (process.platform === 'win32') {
      this.launchWindowsHelper();
      return;
    }

    if (process.platform === 'darwin') {
      this.launchMacHelper();
      return;
    }

    throw new Error('Portable install is not supported on this platform.');
  }

  private launchWindowsHelper(): void {
    const helperPath = join(process.resourcesPath, 'resources', 'portable-updater-win.cjs');
    const nodePath = join(process.resourcesPath, 'bin', 'node.exe');
    if (!existsSync(helperPath) || !existsSync(nodePath)) {
      throw new Error('Portable Windows update helper is not bundled.');
    }

    const rootDir = resolveWindowsPortableRoot();
    const launchTarget = existsSync(join(rootDir, 'Start ClawClaw.vbs'))
      ? join(rootDir, 'Start ClawClaw.vbs')
      : join(rootDir, 'ClawClaw.exe');

    this.updateStatus({ status: 'installing', info: this.status.info, progress: this.status.progress, error: undefined });

    const child = spawn(nodePath, [
      helperPath,
      `--pid=${process.pid}`,
      `--artifact=${this.downloadedArtifactPath}`,
      `--root=${rootDir}`,
      `--launch=${launchTarget}`,
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    markAppQuitting();
    app.quit();
  }

  private launchMacHelper(): void {
    const helperPath = join(process.resourcesPath, 'resources', 'portable-updater-mac.sh');
    if (!existsSync(helperPath)) {
      throw new Error('Portable macOS update helper is not bundled.');
    }

    const bundlePath = resolveMacPortableBundlePath();
    const rootDir = resolveMacPortableRoot();
    const launchTarget = existsSync(join(rootDir, 'Start ClawClaw.command'))
      ? join(rootDir, 'Start ClawClaw.command')
      : bundlePath;
    const portableDataPath = join(bundlePath, 'Contents', 'Resources', 'portable');

    this.updateStatus({ status: 'installing', info: this.status.info, progress: this.status.progress, error: undefined });

    const child = spawn('/bin/sh', [
      helperPath,
      `--pid=${process.pid}`,
      `--artifact=${this.downloadedArtifactPath}`,
      `--bundle=${bundlePath}`,
      `--root=${rootDir}`,
      `--portable-data=${portableDataPath}`,
      `--launch=${launchTarget}`,
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    markAppQuitting();
    app.quit();
  }

  private updateStatus(next: PortableUpdateStatus): void {
    this.status = next;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update:status-changed', this.status);
    }
  }
}

export const portableUpdater = new PortableUpdater();
