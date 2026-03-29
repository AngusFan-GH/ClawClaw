#!/usr/bin/env zx

/**
 * bundle-openclaw-plugins.mjs
 *
 * Build a self-contained mirror of OpenClaw third-party plugins for packaging.
 * Current plugins:
 *   - @openclaw-china/channels -> build/openclaw-plugins/channels
 *   - @tencent-weixin/openclaw-weixin -> build/openclaw-plugins/openclaw-weixin
 *
 * The output plugin directory contains:
 *   - plugin source files (index.ts, openclaw.plugin.json, package.json, ...)
 *   - plugin runtime node_modules/ (flattened direct + transitive deps)
 */

import 'zx/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import bundleValidator from './openclaw-bundle-validator.cjs';

const {
  parseDependencySpec,
  isCheckableRange,
  validateBundledNodeModules,
  formatValidationIssues,
} = bundleValidator;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'build', 'openclaw-plugins');
const NODE_MODULES = path.join(ROOT, 'node_modules');

// On Windows, pnpm virtual store paths can exceed MAX_PATH (260 chars).
// Adding \\?\ prefix bypasses the limit for Win32 fs calls.
// Node.js 18.17+ also handles this transparently when LongPathsEnabled=1,
// but this is an extra safety net for build machines where the registry key
// may not be set yet.
function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
}

const PLUGINS = [
  { npmName: '@openclaw-china/channels', pluginId: 'channels' },
  { npmName: '@tencent-weixin/openclaw-weixin', pluginId: 'openclaw-weixin' },
];

const MOVED_ROOT_PLUGIN_SDK_EXPORTS = {
  resolvePreferredOpenClawTmpDir: 'openclaw/plugin-sdk/temp-path',
};

function getVirtualStoreNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function listPackages(nodeModulesDir) {
  const result = [];
  const nDir = normWin(nodeModulesDir);
  if (!fs.existsSync(nDir)) return result;

  for (const entry of fs.readdirSync(nDir)) {
    if (entry === '.bin') continue;
    // Use original (non-normWin) path so callers can call
    // getVirtualStoreNodeModules() on fullPath correctly.
    const entryPath = path.join(nodeModulesDir, entry);

    if (entry.startsWith('@')) {
      let scopeEntries = [];
      try {
        scopeEntries = fs.readdirSync(normWin(entryPath));
      } catch {
        continue;
      }
      for (const sub of scopeEntries) {
        result.push({
          name: `${entry}/${sub}`,
          fullPath: path.join(entryPath, sub),
        });
      }
    } else {
      result.push({ name: entry, fullPath: entryPath });
    }
  }
  return result;
}

function collectPluginSourceFiles(rootDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(normWin(dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      if (!/\.(ts|js|mjs|cjs)$/.test(entry.name)) continue;
      files.push(fullPath);
    }
  };
  walk(rootDir);
  return files;
}

function parseRootImportSpecifiers(rawSpecifiers) {
  return rawSpecifiers
    .split(',')
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .map((specifier) => {
      const [imported, local] = specifier.split(/\s+as\s+/).map((part) => part.trim());
      return { imported, local: local || imported, raw: specifier };
    });
}

function repairPluginSdkRootImports(rootDir) {
  const importPattern = /^(\s*)import\s+\{([^}]+)\}\s+from\s+["']openclaw\/plugin-sdk["'];?\s*$/gm;
  let changedFiles = 0;

  for (const filePath of collectPluginSourceFiles(rootDir)) {
    const source = fs.readFileSync(normWin(filePath), 'utf8');
    let changed = false;
    const nextContent = source.replace(importPattern, (match, indent, rawSpecifiers) => {
      const specifiers = parseRootImportSpecifiers(rawSpecifiers);
      const remaining = [];
      const movedBySubpath = new Map();

      for (const specifier of specifiers) {
        const subpath = MOVED_ROOT_PLUGIN_SDK_EXPORTS[specifier.imported];
        if (!subpath) {
          remaining.push(specifier.raw);
          continue;
        }
        const movedSpecifiers = movedBySubpath.get(subpath) || [];
        movedSpecifiers.push(
          specifier.imported === specifier.local
            ? specifier.imported
            : `${specifier.imported} as ${specifier.local}`,
        );
        movedBySubpath.set(subpath, movedSpecifiers);
      }

      if (movedBySubpath.size === 0) {
        return match;
      }

      changed = true;
      const lines = [];
      if (remaining.length > 0) {
        lines.push(`${indent}import { ${remaining.join(', ')} } from "openclaw/plugin-sdk";`);
      }
      for (const [subpath, movedSpecifiers] of movedBySubpath.entries()) {
        lines.push(`${indent}import { ${movedSpecifiers.join(', ')} } from "${subpath}";`);
      }
      return lines.join('\n');
    });

    if (!changed || nextContent === source) continue;
    fs.writeFileSync(normWin(filePath), nextContent, 'utf8');
    changedFiles++;
  }

  return changedFiles;
}

function bundleOnePlugin({ npmName, pluginId }) {
  const pkgPath = path.join(NODE_MODULES, ...npmName.split('/'));
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing dependency "${npmName}". Run pnpm install first.`);
  }

  // realpath on Windows can mis-handle extended-length prefixes (\\?\) in
  // some Node versions; resolve symlinks using the native path form.
  const realPluginPath = fs.realpathSync.native(pkgPath);
  const outputDir = path.join(OUTPUT_ROOT, pluginId);

  echo`📦 Bundling plugin ${npmName} -> ${outputDir}`;

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  // 1) Copy plugin package itself
  fs.cpSync(realPluginPath, outputDir, { recursive: true, dereference: true });
  const repairedSourceFiles = repairPluginSdkRootImports(outputDir);
  if (repairedSourceFiles > 0) {
    echo`   🔧 Repaired ${repairedSourceFiles} plugin-sdk import file(s) for ${pluginId}`;
  }

  // 2) Collect transitive deps from pnpm virtual store
  const collectedByName = new Map();
  const discoveredRealPathsByName = new Map();
  const visitedRealPaths = new Set();
  const queue = [];
  const rootVirtualNM = getVirtualStoreNodeModules(realPluginPath);
  if (!rootVirtualNM) {
    throw new Error(`Cannot resolve virtual store node_modules for ${npmName}`);
  }
  queue.push({ nodeModulesDir: rootVirtualNM, skipPkg: npmName });

  // Skip peerDependencies — they're provided by the host openclaw gateway.
  const SKIP_PACKAGES = new Set(['typescript', '@playwright/test']);
  const SKIP_SCOPES = ['@types/'];
  try {
    const pluginPkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf8'));
    for (const peer of Object.keys(pluginPkg.peerDependencies || {})) {
      SKIP_PACKAGES.add(peer);
    }
  } catch { /* ignore */ }
  let skippedDupes = 0;

  function addDiscoveredPackage(pkgName, realPath) {
    let realPaths = discoveredRealPathsByName.get(pkgName);
    if (!realPaths) {
      realPaths = new Set();
      discoveredRealPathsByName.set(pkgName, realPaths);
    }
    realPaths.add(realPath);
  }

  function selectCompatibleRealPath(pkgName, rawRange) {
    const candidates = [...(discoveredRealPathsByName.get(pkgName) || [])];
    if (candidates.length === 0) return null;

    const spec = parseDependencySpec(rawRange);
    if (!spec) return candidates[0];

    for (const realPath of candidates) {
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(realPath, 'package.json'), 'utf8'));
      } catch {
        continue;
      }

      if (spec.type === 'alias' && spec.aliasTarget && pkg.name !== pkgName && pkg.name !== spec.aliasTarget) {
        continue;
      }

      if (!isCheckableRange(spec)) return realPath;
      if (semver.satisfies(pkg.version || '0.0.0', spec.range, { includePrerelease: true, loose: true })) {
        return realPath;
      }
    }

    return null;
  }

  function repairBundledDependencyGraph(nodeModulesRoot) {
    let totalRepairs = 0;

    for (let pass = 0; pass < 8; pass++) {
      const issues = validateBundledNodeModules(nodeModulesRoot);
      if (issues.length === 0) return totalRepairs;

      let repairedThisPass = 0;
      for (const issue of issues) {
        if (issue.type !== 'missing' && issue.type !== 'version-mismatch' && issue.type !== 'alias-mismatch') {
          continue;
        }

        const candidateRealPath = selectCompatibleRealPath(issue.dependencyName, issue.requestedRange);
        if (!candidateRealPath) continue;

        const nestedDest = path.join(issue.packageDir, 'node_modules', issue.dependencyName);
        try {
          fs.rmSync(normWin(nestedDest), { recursive: true, force: true });
          fs.mkdirSync(normWin(path.dirname(nestedDest)), { recursive: true });
          fs.cpSync(normWin(candidateRealPath), normWin(nestedDest), { recursive: true, dereference: true });
          repairedThisPass++;
        } catch (err) {
          echo`   ⚠️  Failed to repair ${issue.packageName} -> ${issue.dependencyName}: ${err.message}`;
        }
      }

      if (repairedThisPass === 0) break;
      totalRepairs += repairedThisPass;
    }

    return totalRepairs;
  }

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg } = queue.shift();
    for (const { name, fullPath } of listPackages(nodeModulesDir)) {
      if (name === skipPkg) continue;
      if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some((s) => name.startsWith(s))) continue;

      let realPath;
      try {
        realPath = fs.realpathSync.native(fullPath);
      } catch {
        continue;
      }
      addDiscoveredPackage(name, realPath);
      const retainedRealPath = collectedByName.get(name);
      if (retainedRealPath == null) {
        collectedByName.set(name, realPath);
      } else if (retainedRealPath !== realPath) {
        skippedDupes++;
      }

      if (visitedRealPaths.has(realPath)) continue;
      visitedRealPaths.add(realPath);

      const depVirtualNM = getVirtualStoreNodeModules(realPath);
      if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
      }
    }
  }

  // 3) Copy flattened deps into plugin/node_modules
  const outputNodeModules = path.join(outputDir, 'node_modules');
  fs.mkdirSync(outputNodeModules, { recursive: true });

  let copiedCount = 0;
  const copiedRealPathsByName = new Map();

  for (const [pkgName, realPath] of collectedByName) {
    const dest = path.join(outputNodeModules, pkgName);
    try {
      fs.mkdirSync(normWin(path.dirname(dest)), { recursive: true });
      fs.cpSync(normWin(realPath), normWin(dest), { recursive: true, dereference: true });
      copiedRealPathsByName.set(pkgName, realPath);
      copiedCount++;
    } catch (err) {
      echo`   ⚠️  Skipped ${pkgName}: ${err.message}`;
    }
  }

  let preservedOverrides = 0;
  for (const [pkgName, pkgRealPath] of collectedByName) {
    if (copiedRealPathsByName.get(pkgName) !== pkgRealPath) continue;

    const packageDest = path.join(outputNodeModules, pkgName);
    if (!fs.existsSync(normWin(packageDest))) continue;

    const depVirtualNM = getVirtualStoreNodeModules(pkgRealPath);
    if (!depVirtualNM) continue;

    for (const { name: depName, fullPath } of listPackages(depVirtualNM)) {
      if (depName === pkgName) continue;
      if (SKIP_PACKAGES.has(depName) || SKIP_SCOPES.some((s) => depName.startsWith(s))) continue;

      let depRealPath;
      try {
        depRealPath = fs.realpathSync.native(fullPath);
      } catch {
        continue;
      }

      const topLevelRealPath = copiedRealPathsByName.get(depName);
      if (!topLevelRealPath || topLevelRealPath === depRealPath) continue;

      const nestedDest = path.join(packageDest, 'node_modules', depName);
      if (fs.existsSync(normWin(nestedDest))) continue;

      try {
        fs.mkdirSync(normWin(path.dirname(nestedDest)), { recursive: true });
        fs.cpSync(normWin(depRealPath), normWin(nestedDest), { recursive: true, dereference: true });
        preservedOverrides++;
      } catch (err) {
        echo`   ⚠️  Failed nested override ${pkgName} -> ${depName}: ${err.message}`;
      }
    }
  }

  const repairedDependencyIssues = repairBundledDependencyGraph(outputNodeModules);
  if (repairedDependencyIssues > 0) {
    echo`   🛠️  ${pluginId}: repaired ${repairedDependencyIssues} bundled dependency override(s)`;
  }

  const manifestPath = path.join(outputDir, 'openclaw.plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing openclaw.plugin.json in bundled plugin output: ${pluginId}`);
  }

  const dependencyIssues = validateBundledNodeModules(outputNodeModules);
  if (dependencyIssues.length > 0) {
    throw new Error(
      `Bundled plugin dependency validation failed for ${pluginId}:\n${formatValidationIssues(dependencyIssues).join('\n')}`
    );
  }

  echo`   ✅ ${pluginId}: copied ${copiedCount} deps (skipped dupes: ${skippedDupes}, preserved overrides: ${preservedOverrides})`;
}

echo`📦 Bundling OpenClaw plugin mirrors...`;
fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

for (const plugin of PLUGINS) {
  bundleOnePlugin(plugin);
}

echo`✅ Plugin mirrors ready: ${OUTPUT_ROOT}`;
