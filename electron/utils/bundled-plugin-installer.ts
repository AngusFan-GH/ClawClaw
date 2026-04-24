import { app } from 'electron';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toFsPath } from './fs-path';
import { getOpenClawDir, resolveOpenClawDir } from './paths';
import {
  hasIncompatibleManagedPluginSdkImports,
  repairManagedPluginSdkImports,
} from './plugin-sdk-compat';
import { logger } from './logger';

// ── Known plugin-ID corrections ─────────────────────────────────────────────
// Some npm packages ship with an openclaw.plugin.json whose "id" field
// doesn't match the ID the plugin code actually exports.  After copying we
// patch both the manifest AND the compiled JS so the Gateway accepts them.
const MANIFEST_ID_FIXES: Record<string, string> = {
  'wecom-openclaw-plugin': 'wecom',
  'openclaw-lark': 'feishu',
};

export interface BundledPluginInstallResult {
  installed: boolean;
  changed?: boolean;
  warning?: string;
  sourceDir?: string;
}

// ── Manifest ID fixup ────────────────────────────────────────────────────────

/**
 * After a plugin has been copied to ~/.openclaw/extensions/<dir>, fix any
 * known manifest-ID mismatches so the Gateway can load the plugin.
 * Also patches package.json fields that the Gateway uses as "entry hints".
 */
function fixupPluginManifest(targetDir: string): void {
  // 1. Fix openclaw.plugin.json id
  const manifestPath = join(targetDir, 'openclaw.plugin.json');
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    const oldId = manifest.id as string | undefined;
    if (oldId && MANIFEST_ID_FIXES[oldId]) {
      const newId = MANIFEST_ID_FIXES[oldId];
      manifest.id = newId;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
      logger.info(`[plugin] Fixed manifest ID: ${oldId} → ${newId}`);
    }
  } catch {
    // manifest may not exist yet — ignore
  }

  // 2. Fix package.json fields that Gateway uses as "entry hints"
  const pkgPath = join(targetDir, 'package.json');
  try {
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    let modified = false;

    for (const [oldId, newId] of Object.entries(MANIFEST_ID_FIXES)) {
      if (typeof pkg.name === 'string' && pkg.name.includes(oldId)) {
        pkg.name = pkg.name.replace(oldId, newId);
        modified = true;
      }
      const openclaw = pkg.openclaw as Record<string, unknown> | undefined;
      if (openclaw) {
        if (typeof openclaw.install === 'object' && openclaw.install !== null) {
          const install = openclaw.install as Record<string, unknown>;
          if (typeof install.npmSpec === 'string' && install.npmSpec.includes(oldId)) {
            install.npmSpec = install.npmSpec.replace(oldId, newId);
            modified = true;
          }
          if (typeof install.localPath === 'string' && install.localPath.includes(oldId)) {
            install.localPath = install.localPath.replace(oldId, newId);
            modified = true;
          }
        }
      }
    }

    if (modified) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      logger.info(`[plugin] Fixed package.json entry hints in ${targetDir}`);
    }
  } catch {
    // ignore
  }

  // 3. Fix hardcoded plugin IDs in compiled JS entry files.
  patchPluginEntryIds(targetDir);
}

/**
 * Patch compiled JS entry files so the hardcoded `id` field in the
 * plugin export matches the manifest.  Without this, the Gateway rejects
 * the plugin with "plugin id mismatch".
 */
function patchPluginEntryIds(targetDir: string): void {
  const pkgPath = join(targetDir, 'package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return;
  }

  const entryFiles = [pkg.main, pkg.module].filter(Boolean) as string[];

  for (const entry of entryFiles) {
    const entryPath = join(targetDir, entry);
    if (!existsSync(entryPath)) continue;

    let content: string;
    try {
      content = readFileSync(entryPath, 'utf-8');
    } catch {
      continue;
    }

    let patched = false;
    for (const [wrongId, correctId] of Object.entries(MANIFEST_ID_FIXES)) {
      const escapedWrongId = wrongId.replace(/-/g, '\\-');
      const pattern = new RegExp(`(\\bid\\s*:\\s*)(["'])${escapedWrongId}\\2`, 'g');
      const replaced = content.replace(pattern, `$1$2${correctId}$2`);
      if (replaced !== content) {
        content = replaced;
        patched = true;
        logger.info(`[plugin] Patched plugin ID in ${entry}: "${wrongId}" → "${correctId}"`);
      }
    }

    if (patched) {
      writeFileSync(entryPath, content, 'utf-8');
    }
  }
}

function finalizeInstalledManagedPlugin(
  targetDir: string,
  targetManifest: string,
  pluginId: string,
  displayName: string,
  sourceDir: string,
): BundledPluginInstallResult {
  // Fix manifest ID, package.json entry hints, and compiled JS IDs.
  fixupPluginManifest(targetDir);
  repairManagedPluginSdkImports(targetDir);

  if (!existsSync(targetManifest)) {
    return {
      installed: false,
      warning: `Failed to install ${displayName} plugin mirror (manifest missing).`,
      sourceDir,
    };
  }

  if (hasIncompatibleManagedPluginSdkImports(targetDir)) {
    try {
      rmSync(toFsPath(targetDir), { recursive: true, force: true });
    } catch {
      // ignore cleanup failure and surface the real compatibility error below
    }
    return {
      installed: false,
      warning: `Bundled ${displayName} plugin mirror is incompatible with the current OpenClaw SDK.`,
      sourceDir,
    };
  }

  if (readPluginManifestId(targetDir) !== pluginId) {
    try {
      rmSync(toFsPath(targetDir), { recursive: true, force: true });
    } catch {
      // ignore cleanup failure and surface the real manifest error below
    }
    return {
      installed: false,
      warning: `Bundled ${displayName} plugin mirror manifest id is invalid.`,
      sourceDir,
    };
  }

  return { installed: true, changed: true, sourceDir };
}

function findOpenClawBundledExtension(pluginId: string): string | null {
  const candidateRoots = app.isPackaged
    ? [
        getOpenClawDir(),
        join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'openclaw'),
        join(process.resourcesPath, 'node_modules', 'openclaw'),
      ]
    : [
        getOpenClawDir(),
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
  return normalized.includes('/openclaw/dist/extensions/');
}

function readPluginVersion(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { version?: string };
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null;
  } catch {
    return null;
  }
}

function readPluginManifestId(dir: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'openclaw.plugin.json'), 'utf-8')) as { id?: string };
    return typeof manifest.id === 'string' && manifest.id.trim() ? manifest.id.trim() : null;
  } catch {
    return null;
  }
}

function hasBundledRuntimeDependencies(dir: string): boolean {
  return existsSync(join(dir, 'node_modules'));
}

function isPluginMirrorInstallHealthy(targetDir: string, sourceDir: string, pluginId: string): boolean {
  const targetManifest = join(targetDir, 'openclaw.plugin.json');
  const targetPackage = join(targetDir, 'package.json');

  if (!existsSync(targetManifest) || !existsSync(targetPackage)) {
    return false;
  }

  const targetManifestId = readPluginManifestId(targetDir);
  if (targetManifestId !== pluginId) {
    return false;
  }

  const sourceManifestId = readPluginManifestId(sourceDir);
  if (sourceManifestId && sourceManifestId !== targetManifestId) {
    return false;
  }

  const targetVersion = readPluginVersion(targetDir);
  const sourceVersion = readPluginVersion(sourceDir);
  if (!targetVersion || !sourceVersion || targetVersion !== sourceVersion) {
    return false;
  }

  if (hasBundledRuntimeDependencies(sourceDir) && !hasBundledRuntimeDependencies(targetDir)) {
    return false;
  }

  if (hasIncompatibleManagedPluginSdkImports(targetDir)) {
    return false;
  }

  return true;
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
  options?: { forceReinstall?: boolean },
): BundledPluginInstallResult {
  const targetDir = join(resolveOpenClawDir(), 'extensions', pluginId);
  const targetManifest = join(targetDir, 'openclaw.plugin.json');
  const sourceDir = findBundledPluginMirror(pluginId);
  const forceReinstall = options?.forceReinstall === true;
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
    let changed = false;
    if (existsSync(targetManifest)) {
      try {
        rmSync(toFsPath(targetDir), { recursive: true, force: true });
        changed = true;
      } catch {
        return {
          installed: false,
          warning: `Failed to remove stale mirrored ${displayName} plugin`,
          sourceDir,
        };
      }
    }
    return { installed: true, changed, sourceDir };
  }

  if (existsSync(targetManifest)) {
    if (!forceReinstall && isPluginMirrorInstallHealthy(targetDir, sourceDir, pluginId)) {
      return { installed: true, changed: false, sourceDir };
    }
  }

  try {
    mkdirSync(toFsPath(join(resolveOpenClawDir(), 'extensions')), { recursive: true });
    rmSync(toFsPath(targetDir), { recursive: true, force: true });
    cpSync(toFsPath(sourceDir), toFsPath(targetDir), { recursive: true, dereference: true });
    return finalizeInstalledManagedPlugin(targetDir, targetManifest, pluginId, displayName, sourceDir);
  } catch {
    return {
      installed: false,
      warning: `Failed to install bundled ${displayName} plugin mirror`,
    };
  }
}
