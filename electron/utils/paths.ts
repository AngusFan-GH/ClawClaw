/**
 * Path Utilities
 * Cross-platform path resolution helpers
 */
import { app } from 'electron';
import { join, resolve, sep } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'fs';
import { logger } from './logger';

// ── Portable Mode ────────────────────────────────────────────────────────────

/**
 * Detects whether the app is running in portable (USB) mode.
 *
 * Approach: check for a `portable/` directory that sits alongside the app bundle.
 * Falls back to the legacy `.portable` marker file for backward compatibility.
 *
 * Directory structure on USB drive:
 *   USB/
 *   ├── ClawClaw.exe              (Windows: next to portable/)
 *   ├── ClawClaw.app/             (macOS: portable/ inside the .app bundle)
 *   └── portable/                 ← data directory (all user data here)
 *       ├── .openclaw/            (OpenClaw state)
 *       ├── cache/
 *       ├── python/
 *       └── logs/
 *
 * This mirrors u-claw's portable detection: `portable/` directory
 * existence is more robust than walking up directory trees for a marker file.
 */
function detectPortableBaseDir(): string | null {
  try {
    const appPath = app.getAppPath();
    if (!appPath || appPath === process.execPath) return null;

    const resolved = resolve(appPath);

    // ── macOS: portable/ is INSIDE the .app bundle at Contents/Resources/portable ──
    // app.getAppPath() returns Contents/Resources/app/ on macOS.
    // We look for Contents/Resources/portable/ and return its parent (the .app root).
    const MACOS_APP_PATH_SUFFIX = join('Contents', 'Resources', 'app');
    if (resolved.endsWith(MACOS_APP_PATH_SUFFIX)) {
      const bundleRoot = resolved.slice(0, -MACOS_APP_PATH_SUFFIX.length - 1);
      const portableDir = join(bundleRoot, 'Contents', 'Resources', 'portable');
      if (existsSync(portableDir)) {
        logger.info(`[portable] Detected at ${portableDir} (inside .app bundle)`);
        return portableDir;
      }
      // Fall through to marker-based detection
    }

    // ── Windows / Linux: portable/ is a SIBLING of the app directory ──
    // app.getAppPath() returns the unpacked app dir (e.g. win-unpacked/).
    const sibling = join(resolved, 'portable');
    if (existsSync(sibling)) {
      logger.info(`[portable] Detected at ${sibling} (sibling of app)`);
      return sibling;
    }

    // ── Legacy fallback: walk up looking for .portable marker file ──
    const parts = resolved.split(sep);
    for (let i = 0; i <= parts.length; i++) {
      const base = parts.slice(0, i + 1).join('/') || '/';
      if (existsSync(join(base, '.portable'))) {
        logger.info(`[portable] Legacy .portable marker found at ${base}`);
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
 * Returns the portable data directory if portable mode is active, otherwise null.
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
 * Returns the portable OpenClaw state directory.
 * In portable mode: <portable>/.openclaw
 * Returns null if not in portable mode.
 */
export function getPortableOpenClawDir(): string | null {
  const base = getPortableBase();
  if (!base) return null;
  return join(base, '.openclaw');
}

/**
 * Returns the portable Python runtime directory.
 * In portable mode: <portable>/python/
 * Returns null if not in portable mode.
 */
export function getPortablePythonHome(): string | null {
  const base = getPortableBase();
  if (!base) return null;
  return join(base, 'python');
}

/**
 * Returns the portable uv cache directory.
 * In portable mode: <portable>/cache/
 * Returns null if not in portable mode.
 */
export function getPortableUvCacheDir(): string | null {
  const base = getPortableBase();
  if (!base) return null;
  return join(base, 'cache');
}

export type ExportCategory = 'general' | 'images' | 'settings';

/**
 * Get the default directory for user-initiated exports/saves.
 * In portable mode: <portable>/exports/<category>
 * Otherwise: ~/Downloads
 */
export function getDefaultExportDir(category: ExportCategory = 'general'): string {
  const base = getPortableBase();
  if (base) return join(base, 'exports', category);
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
  const base = getPortableBase();
  if (base) return base;
  return join(homedir(), '.clawclaw');
}

/**
 * Get ClawClaw logs directory.
 * In portable mode: <portable>/logs
 * Otherwise: app.getPath('userData')/logs
 */
export function getLogsDir(): string {
  const base = getPortableBase();
  if (base) return join(base, 'logs');
  return join(app.getPath('userData'), 'logs');
}

/**
 * Get ClawClaw data directory.
 * In portable mode: <portable>
 * Otherwise: app.getPath('userData')
 */
export function getDataDir(): string {
  const base = getPortableBase();
  if (base) return base;
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
