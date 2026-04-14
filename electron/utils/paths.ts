/**
 * Path Utilities
 * Cross-platform path resolution helpers
 */
import { app } from 'electron';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'fs';
import { logger } from './logger';

// ── Portable Mode ────────────────────────────────────────────────────────────

/**
 * Detects whether the app is running in portable mode.
 *
 * Portable mode is active when a `.portable` marker file exists at the root
 * of the app bundle (next to ClawClaw.exe on Windows, or inside ClawClaw.app
 * on macOS). When detected, all user data (settings, logs, OpenClaw config)
 * is stored inside a `portable/` subdirectory next to the app — so the entire
 * USB drive is self-contained and leaves no traces on the host machine.
 *
 * Usage: place an empty file named `.portable` in the same directory as
 * ClawClaw.exe (Windows) or at Contents/Resources/.portable inside
 * ClawClaw.app (macOS).
 */
function detectPortableBaseDir(): string | null {
  try {
    const appPath = app.getAppPath();
    if (!appPath || appPath === process.execPath) return null;

    // Walk up from app path toward filesystem root, looking for .portable marker.
    // On macOS the marker is typically at Contents/Resources/.portable.
    // On Windows it is at <app-dir>/.portable (same dir as the .exe).
    const parts = resolve(appPath).split(/[/\\]/);
    for (let i = 0; i <= parts.length; i++) {
      const base = parts.slice(0, i + 1).join('/') || '/';
      if (existsSync(join(base, '.portable'))) {
        logger.info(`[portable] Marker found at ${base}`);
        return base;
      }
    }
  } catch {
    // best-effort
  }
  return null;
}

// Cached portable base (set once at startup — must be called after app.whenReady)
let _portableBase: string | null | undefined = undefined;

/**
 * Returns the portable base directory if portable mode is active, otherwise null.
 * The result is cached after the first call.
 */
export function getPortableBase(): string | null {
  if (_portableBase !== undefined) return _portableBase;
  if (!app.isPackaged) {
    _portableBase = null;
    return null;
  }
  _portableBase = detectPortableBaseDir();
  return _portableBase;
}

/**
 * Returns the portable data directory (portableBase + 'portable/').
 * Returns null if not in portable mode.
 */
export function getPortableDataDir(): string | null {
  const base = getPortableBase();
  if (!base) return null;
  return join(base, 'portable');
}

/**
 * Returns the portable .openclaw directory.
 * Returns null if not in portable mode.
 */
export function getPortableOpenClawDir(): string | null {
  const data = getPortableDataDir();
  if (!data) return null;
  return join(data, '.openclaw');
}

export {
  quoteForCmd,
  needsWinShell,
  prepareWinSpawn,
  normalizeNodeRequirePathForNodeOptions,
  appendNodeRequireToNodeOptions,
} from './win-shell';

/**
 * Expand ~ to home directory
 */
export function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  return path;
}

/**
 * Get OpenClaw config directory.
 * In portable mode: <portable>/portable/.openclaw
 * Otherwise: ~/.openclaw
 */
export function getOpenClawConfigDir(): string {
  const portable = getPortableOpenClawDir();
  if (portable) return portable;
  return join(homedir(), '.openclaw');
}

/**
 * Get OpenClaw skills directory
 */
export function getOpenClawSkillsDir(): string {
  return join(getOpenClawConfigDir(), 'skills');
}

/**
 * Get ClawClaw config directory.
 * In portable mode: <portable>/portable (shares .openclaw parent)
 * Otherwise: ~/.clawclaw
 */
export function getClawXConfigDir(): string {
  const portableData = getPortableDataDir();
  if (portableData) return portableData;
  return join(homedir(), '.clawclaw');
}

/**
 * Get ClawClaw logs directory.
 * In portable mode: <portable>/portable/logs
 * Otherwise: app.getPath('userData')/logs
 */
export function getLogsDir(): string {
  const portableData = getPortableDataDir();
  if (portableData) return join(portableData, 'logs');
  return join(app.getPath('userData'), 'logs');
}

/**
 * Get ClawClaw data directory.
 * In portable mode: <portable>/portable
 * Otherwise: app.getPath('userData')
 */
export function getDataDir(): string {
  const portableData = getPortableDataDir();
  if (portableData) return portableData;
  return app.getPath('userData');
}

/**
 * Ensure directory exists
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get resources directory (for bundled assets)
 */
export function getResourcesDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources');
  }
  return join(__dirname, '../../resources');
}

/**
 * Get preload script path
 */
export function getPreloadPath(): string {
  return join(__dirname, '../preload/index.js');
}

/**
 * Get OpenClaw package directory
 * - Production (packaged): from resources/openclaw (copied by electron-builder extraResources)
 * - Development: from node_modules/openclaw
 */
export function getOpenClawDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'openclaw');
  }
  // Development: use node_modules/openclaw
  return join(__dirname, '../../node_modules/openclaw');
}

/**
 * Get OpenClaw package directory resolved to a real path.
 * Useful when consumers need deterministic module resolution under pnpm symlinks.
 */
export function getOpenClawResolvedDir(): string {
  const dir = getOpenClawDir();
  if (!existsSync(dir)) {
    return dir;
  }
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * Get OpenClaw entry script path (openclaw.mjs)
 */
export function getOpenClawEntryPath(): string {
  return join(getOpenClawDir(), 'openclaw.mjs');
}

/**
 * Get ClawHub CLI entry script path (clawdhub.js)
 */
export function getClawHubCliEntryPath(): string {
  return join(app.getAppPath(), 'node_modules', 'clawhub', 'bin', 'clawdhub.js');
}

/**
 * Get ClawHub CLI binary path (node_modules/.bin)
 */
export function getClawHubCliBinPath(): string {
  const binName = process.platform === 'win32' ? 'clawhub.cmd' : 'clawhub';
  return join(app.getAppPath(), 'node_modules', '.bin', binName);
}

/**
 * Check if OpenClaw package exists
 */
export function isOpenClawPresent(): boolean {
  const dir = getOpenClawDir();
  const pkgJsonPath = join(dir, 'package.json');
  return existsSync(dir) && existsSync(pkgJsonPath);
}

/**
 * Check if OpenClaw is built (has dist folder)
 * For the npm package, this should always be true since npm publishes the built dist.
 */
export function isOpenClawBuilt(): boolean {
  const dir = getOpenClawDir();
  const distDir = join(dir, 'dist');
  const hasDist = existsSync(distDir);
  return hasDist;
}

/**
 * Get OpenClaw status for environment check
 */
export interface OpenClawStatus {
  packageExists: boolean;
  isBuilt: boolean;
  entryPath: string;
  dir: string;
  version?: string;
}

export function getOpenClawStatus(): OpenClawStatus {
  const dir = getOpenClawDir();
  let version: string | undefined;

  // Try to read version from package.json
  try {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      version = pkg.version;
    }
  } catch {
    // Ignore version read errors
  }

  const status: OpenClawStatus = {
    packageExists: isOpenClawPresent(),
    isBuilt: isOpenClawBuilt(),
    entryPath: getOpenClawEntryPath(),
    dir,
    version,
  };

  logger.info('OpenClaw status:', status);
  return status;
}
