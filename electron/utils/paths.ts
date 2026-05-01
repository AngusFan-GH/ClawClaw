/**
 * Path Utilities
 * Cross-platform path resolution helpers
 */
import { app } from 'electron';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'fs';
import { logger } from './logger';

// ── Portable Mode ────────────────────────────────────────────────────────────

type PortablePaths = {
  rootDir: string;
  dataDir: string;
};

/**
 * Detects whether the app is running in portable (USB) mode.
 *
 * Portable mode is enabled only when a bundled `portable/` data directory exists.
 * That keeps regular installed builds and portable builds on separate, explicit
 * packaging paths instead of relying on legacy marker files.
 *
 * Directory structure on USB drive:
 *   USB/
 *   ├── ClawClaw.exe              (Windows: next to portable/)
 *   ├── Start ClawClaw.bat/.vbs   (Windows portable launchers)
 *   ├── ClawClaw.app/             (macOS: portable/ inside the .app bundle)
 *   ├── Start ClawClaw.command    (macOS portable launcher)
 *   └── portable/                 ← data directory (all user data here)
 *       ├── .openclaw/            (OpenClaw state)
 *       ├── cache/
 *       ├── python/
 *       └── logs/
 */
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

function detectPortablePaths(): PortablePaths | null {
  try {
    const resourcesDir = getPackagedResourcesDir();
    const isMac = process.platform === 'darwin';
    const dataDir = isMac
      ? join(resourcesDir, 'portable')
      : join(dirname(resourcesDir), 'portable');
    const rootDir = isMac ? dirname(dirname(resourcesDir)) : dirname(resourcesDir);

    if (existsSync(dataDir)) {
      logger.info(`[portable] Detected root=${rootDir} data=${dataDir}`);
      return { rootDir, dataDir };
    }
  } catch {
    // best-effort
  }
  return null;
}

// Cached portable paths (set once at startup — must be called after app.whenReady)
let _portablePaths: PortablePaths | null | undefined = undefined;

/**
 * Returns the portable bundle root if portable mode is active, otherwise null.
 * The result is cached after the first call.
 */
export function getPortableRootDir(): string | null {
  if (_portablePaths !== undefined) return _portablePaths?.rootDir ?? null;
  if (!app?.isPackaged) {
    _portablePaths = null;
    return null;
  }
  _portablePaths = detectPortablePaths();
  return _portablePaths?.rootDir ?? null;
}

/**
 * Returns the portable data directory if portable mode is active, otherwise null.
 */
export function getPortableDataDir(): string | null {
  if (_portablePaths === undefined) {
    getPortableRootDir();
  }
  return _portablePaths?.dataDir ?? null;
}

/**
 * Returns the portable OpenClaw state directory.
 * In portable mode: <portable>/.openclaw
 * Returns null if not in portable mode.
 */
export function getPortableOpenClawDir(): string | null {
  const dataDir = getPortableDataDir();
  if (!dataDir) return null;
  return join(dataDir, '.openclaw');
}

/**
 * Returns the portable Python runtime directory.
 * In portable mode: <portable>/python/
 * Returns null if not in portable mode.
 */
export function getPortablePythonHome(): string | null {
  const dataDir = getPortableDataDir();
  if (!dataDir) return null;
  return join(dataDir, 'python');
}

/**
 * Returns the portable uv cache directory.
 * In portable mode: <portable>/cache/
 * Returns null if not in portable mode.
 */
export function getPortableUvCacheDir(): string | null {
  const dataDir = getPortableDataDir();
  if (!dataDir) return null;
  return join(dataDir, 'cache');
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
 * - Portable mode: portable/python
 * - Packaged Windows installs without bundled Python: app userData/python
 * - Other environments: null (let uv use its defaults)
 */
export function getManagedPythonHome(): string | null {
  const portable = getPortablePythonHome();
  if (portable) return portable;
  if (process.platform === 'win32' && app.isPackaged) {
    if (getBundledPythonExecutable()) return null;
    return join(getDataDir(), 'python');
  }
  return null;
}

/**
 * Returns the managed uv cache directory ClawClaw should use.
 *
 * - Portable mode: portable/cache
 * - Packaged Windows installs: app userData/uv-cache
 * - Other environments: null (let uv use its defaults)
 */
export function getManagedUvCacheDir(): string | null {
  const portable = getPortableUvCacheDir();
  if (portable) return portable;
  if (process.platform === 'win32' && app.isPackaged) {
    return join(getDataDir(), 'uv-cache');
  }
  return null;
}

export type ExportCategory = 'general' | 'images' | 'settings';

/**
 * Get the default directory for user-initiated exports/saves.
 * In portable mode: <portable>/exports/<category>
 * Otherwise: ~/Downloads
 */
export function getDefaultExportDir(category: ExportCategory = 'general'): string {
  const dataDir = getPortableDataDir();
  if (dataDir) return join(dataDir, 'exports', category);
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
 * In portable mode: <portable>/.openclaw
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
 * In portable mode: <portable>
 * Otherwise: ~/.clawclaw
 */
export function getClawXConfigDir(): string {
  const dataDir = getPortableDataDir();
  if (dataDir) return dataDir;
  return join(homedir(), '.clawclaw');
}

/**
 * Get ClawClaw logs directory.
 * In portable mode: <portable>/logs
 * Otherwise: app.getPath('userData')/logs
 */
export function getLogsDir(): string {
  const dataDir = getPortableDataDir();
  if (dataDir) return join(dataDir, 'logs');
  return join(app.getPath('userData'), 'logs');
}

/**
 * Get ClawClaw data directory.
 * In portable mode: <portable>
 * Otherwise: app.getPath('userData')
 */
export function getDataDir(): string {
  const dataDir = getPortableDataDir();
  if (dataDir) return dataDir;
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
 * and portable mode.
 *
 * Priority:
 *   1. OPENCLAW_STATE_DIR  — explicit state dir (used by portable mode)
 *   2. getPortableOpenClawDir() — portable USB mode
 *   3. ~/.openclaw          — default
 *
 * Note: OPENCLAW_HOME is NOT used. OpenClaw treats it as a home-directory
 * (and appends ".openclaw" internally), causing ~/.openclaw/.openclaw duplication.
 * Use OPENCLAW_STATE_DIR instead for custom state directories.
 */
export function resolveOpenClawDir(): string {
  if (process.env.OPENCLAW_STATE_DIR) return process.env.OPENCLAW_STATE_DIR;
  const portable = getPortableOpenClawDir();
  if (portable) return portable;
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
