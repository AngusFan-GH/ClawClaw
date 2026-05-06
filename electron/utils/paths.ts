/**
 * Path Utilities
 * Cross-platform path resolution helpers
 */
import { app } from 'electron';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'fs';
import { logger } from './logger';

function getPackagedResourcesDir(): string {
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    return resolve(process.resourcesPath);
  }

  const appPath = resolve(app.getAppPath());
  const resourcesSuffixes = [
    join('Contents', 'Resources', 'app'),
    join('Contents', 'Resources', 'app.asar'),
    join('resources', 'app'),
    join('resources', 'app.asar'),
  ];

  for (const suffix of resourcesSuffixes) {
    if (appPath.endsWith(suffix)) {
      return dirname(appPath);
    }
  }

  return resolve(appPath, 'resources');
}

/**
 * Returns the bundled Python runtime directory when a packaged Windows build
 * ships Python in resources/python.
 */
export function getBundledPythonHome(): string | null {
  if (process.platform !== 'win32') return null;

  const target = `${process.platform}-${process.arch}`;
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'python')]
    : [join(process.cwd(), 'resources', 'python', target)];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'python.exe'))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Returns the bundled Python executable path for Windows builds, if present.
 */
export function getBundledPythonExecutable(): string | null {
  const home = getBundledPythonHome();
  if (!home) return null;
  return join(home, 'python.exe');
}

/**
 * Environment variables shared by uv/OpenClaw child processes.
 *
 * Packaged Windows builds prefer the read-only bundled Python executable, so
 * first launch does not need to download Python. If the bundle is missing, we
 * keep the managed uv install directory fallback for development and recovery.
 */
export function getManagedPythonEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const bundledPython = getBundledPythonExecutable();
  const managedUvCache = getManagedUvCacheDir();

  if (bundledPython) {
    env.UV_PYTHON = bundledPython;
    env.UV_MANAGED_PYTHON = 'false';
  } else {
    const managedPythonHome = getManagedPythonHome();
    if (managedPythonHome) {
      env.UV_PYTHON_INSTALL_DIR = managedPythonHome;
    }
  }

  if (managedUvCache) {
    env.UV_CACHE_DIR = managedUvCache;
  }

  return env;
}

/**
 * Returns the managed Python runtime directory ClawClaw should use for uv.
 *
 * - Packaged Windows installs without bundled Python: app userData/python
 * - Other environments: null (let uv use its defaults)
 */
export function getManagedPythonHome(): string | null {
  if (process.platform === 'win32' && app.isPackaged) {
    if (getBundledPythonExecutable()) return null;
    return join(getDataDir(), 'python');
  }
  return null;
}

/**
 * Returns the managed uv cache directory ClawClaw should use.
 *
 * - Packaged Windows installs: app userData/uv-cache
 * - Other environments: null (let uv use its defaults)
 */
export function getManagedUvCacheDir(): string | null {
  if (process.platform === 'win32' && app.isPackaged) {
    return join(getDataDir(), 'uv-cache');
  }
  return null;
}

export type ExportCategory = 'general' | 'images' | 'settings';

/**
 * Get the default directory for user-initiated exports/saves.
 */
export function getDefaultExportDir(category: ExportCategory = 'general'): string {
  void category;
  return join(homedir(), 'Downloads');
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
 */
export function getOpenClawConfigDir(): string {
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
 */
export function getClawXConfigDir(): string {
  return join(homedir(), '.clawclaw');
}

/**
 * Get ClawClaw logs directory.
 */
export function getLogsDir(): string {
  return join(app.getPath('userData'), 'logs');
}

/**
 * Get ClawClaw data directory.
 */
export function getDataDir(): string {
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
    return join(getPackagedResourcesDir(), 'resources');
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
    return join(getPackagedResourcesDir(), 'openclaw');
  }
  // Development: use node_modules/openclaw
  return join(__dirname, '../../node_modules/openclaw');
}

/**
 * Resolve the OpenClaw config/state directory, respecting OpenClaw env vars
 * and falling back to the default user OpenClaw directory.
 *
 * Priority:
 *   1. OPENCLAW_STATE_DIR  — explicit state dir
 *   2. ~/.openclaw         — default
 *
 * Note: OPENCLAW_HOME is NOT used. OpenClaw treats it as a home-directory
 * (and appends ".openclaw" internally), causing ~/.openclaw/.openclaw duplication.
 * Use OPENCLAW_STATE_DIR instead for custom state directories.
 */
export function resolveOpenClawDir(): string {
  if (process.env.OPENCLAW_STATE_DIR) return process.env.OPENCLAW_STATE_DIR;
  return join(homedir(), '.openclaw');
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
  return existsSync(distDir);
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
