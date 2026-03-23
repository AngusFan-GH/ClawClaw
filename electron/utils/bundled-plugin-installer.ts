import { app } from 'electron';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toFsPath } from './fs-path';

export interface BundledPluginInstallResult {
  installed: boolean;
  warning?: string;
  sourceDir?: string;
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

  return candidateSources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json'))) || null;
}

export function ensureBundledPluginInstalled(
  pluginId: string,
  displayName: string,
): BundledPluginInstallResult {
  const targetDir = join(homedir(), '.openclaw', 'extensions', pluginId);
  const targetManifest = join(targetDir, 'openclaw.plugin.json');

  if (existsSync(targetManifest)) {
    return { installed: true };
  }

  const sourceDir = findBundledPluginMirror(pluginId);
  if (!sourceDir) {
    return {
      installed: false,
      warning: `Bundled ${displayName} plugin mirror not found.`,
    };
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
