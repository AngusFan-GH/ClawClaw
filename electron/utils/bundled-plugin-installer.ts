import { app } from 'electron';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toFsPath } from './fs-path';

export interface BundledPluginInstallResult {
  installed: boolean;
  warning?: string;
  sourceDir?: string;
}

function findOpenClawBundledExtension(pluginId: string): string | null {
  const candidateRoots = app.isPackaged
    ? [
        join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'openclaw'),
        join(process.resourcesPath, 'node_modules', 'openclaw'),
      ]
    : [
        join(app.getAppPath(), 'node_modules', 'openclaw'),
        join(process.cwd(), 'node_modules', 'openclaw'),
      ];

  for (const root of candidateRoots) {
    const candidate = join(root, 'dist', 'extensions', pluginId);
    if (existsSync(join(candidate, 'openclaw.plugin.json'))) {
      return candidate;
    }
  }

  return null;
}

function isOpenClawBundledExtensionSource(sourceDir: string): boolean {
  const normalized = sourceDir.replace(/\\/g, '/');
  return normalized.includes('/node_modules/openclaw/dist/extensions/');
}

function readPluginVersion(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { version?: string };
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null;
  } catch {
    return null;
  }
}

export function findBundledPluginMirror(pluginId: string): string | null {
  const candidateSources = app.isPackaged
    ? [
        join(process.resourcesPath, 'openclaw-plugins', pluginId),
        join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', pluginId),
        join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', pluginId),
      ]
    : [
        join(app.getAppPath(), 'build', 'openclaw-plugins', pluginId),
        join(process.cwd(), 'build', 'openclaw-plugins', pluginId),
        join(__dirname, '../../build/openclaw-plugins', pluginId),
      ];

  return candidateSources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json')))
    || findOpenClawBundledExtension(pluginId);
}

export function ensureBundledPluginInstalled(
  pluginId: string,
  displayName: string,
): BundledPluginInstallResult {
  const targetDir = join(homedir(), '.openclaw', 'extensions', pluginId);
  const targetManifest = join(targetDir, 'openclaw.plugin.json');
  const sourceDir = findBundledPluginMirror(pluginId);
  if (!sourceDir) {
    return {
      installed: false,
      warning: `Bundled ${displayName} plugin mirror not found.`,
    };
  }

  // Official OpenClaw bundled extensions should be loaded from the runtime's
  // own dist/extensions tree. Copying them into ~/.openclaw/extensions causes
  // duplicate plugin-id warnings and can mask the real bundled version.
  if (isOpenClawBundledExtensionSource(sourceDir)) {
    if (existsSync(targetManifest)) {
      try {
        rmSync(toFsPath(targetDir), { recursive: true, force: true });
      } catch {
        return {
          installed: false,
          warning: `Failed to remove stale mirrored ${displayName} plugin`,
          sourceDir,
        };
      }
    }
    return { installed: true, sourceDir };
  }

  if (existsSync(targetManifest)) {
    const targetVersion = readPluginVersion(targetDir);
    const sourceVersion = readPluginVersion(sourceDir);
    if (targetVersion && sourceVersion && targetVersion === sourceVersion) {
      return { installed: true, sourceDir };
    }
  }

  try {
    mkdirSync(toFsPath(join(homedir(), '.openclaw', 'extensions')), { recursive: true });
    rmSync(toFsPath(targetDir), { recursive: true, force: true });
    cpSync(toFsPath(sourceDir), toFsPath(targetDir), { recursive: true, dereference: true });
    if (!existsSync(targetManifest)) {
      return {
        installed: false,
        warning: `Failed to install ${displayName} plugin mirror (manifest missing).`,
      };
    }
    return { installed: true, sourceDir };
  } catch {
    return {
      installed: false,
      warning: `Failed to install bundled ${displayName} plugin mirror`,
    };
  }
}
