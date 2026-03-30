/**
 * after-pack.cjs
 *
 * electron-builder afterPack hook.
 *
 * Problem: electron-builder respects .gitignore when copying extraResources.
 * Since .gitignore contains "node_modules/", the openclaw bundle's
 * node_modules directory is silently skipped during the extraResources copy.
 *
 * Solution: This hook runs AFTER electron-builder finishes packing. It manually
 * copies build/openclaw/node_modules/ into the output resources directory,
 * bypassing electron-builder's glob filtering entirely.
 *
 * Additionally it performs two rounds of cleanup:
 *   1. General cleanup — removes dev artifacts (type defs, source maps, docs,
 *      test dirs) from both the openclaw root and its node_modules.
 *   2. Platform-specific cleanup — strips native binaries for non-target
 *      platforms (koffi multi-platform prebuilds, @napi-rs/canvas, @img/sharp,
 *      @mariozechner/clipboard).
 */

const { cpSync, existsSync, readdirSync, rmSync, statSync, mkdirSync, realpathSync } = require('fs');
const { join, dirname, basename } = require('path');
const semver = require('semver');
const {
  parseDependencySpec,
  isCheckableRange,
  validateBundledNodeModules,
  formatValidationIssues,
} = require('./openclaw-bundle-validator.cjs');

const ROOT_PLUGIN_SDK_SPEC = 'openclaw/plugin-sdk';
const COMPAT_PLUGIN_SDK_SPEC = 'openclaw/plugin-sdk/compat';
const MOVED_ROOT_PLUGIN_SDK_EXPORTS = {
  resolvePreferredOpenClawTmpDir: 'openclaw/plugin-sdk/infra-runtime',
};

// On Windows, paths in pnpm's virtual store can exceed the default MAX_PATH
// limit (260 chars). Node.js 18.17+ respects the system LongPathsEnabled
// registry key, but as a safety net we normalize paths to use the \\?\ prefix
// on Windows, which bypasses the limit unconditionally.
function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
}

// ── Arch helpers ─────────────────────────────────────────────────────────────
// electron-builder Arch enum: 0=ia32, 1=x64, 2=armv7l, 3=arm64, 4=universal
const ARCH_MAP = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function resolveArch(archEnum) {
  return ARCH_MAP[archEnum] || 'x64';
}

// ── General cleanup ──────────────────────────────────────────────────────────

function cleanupUnnecessaryFiles(dir) {
  let removedCount = 0;

  const REMOVE_DIRS = new Set([
    'test', 'tests', '__tests__', '.github', 'examples', 'example',
  ]);
  const REMOVE_FILE_EXTS = ['.d.ts', '.d.ts.map', '.js.map', '.mjs.map', '.ts.map', '.markdown'];
  const REMOVE_FILE_NAMES = new Set([
    '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
    'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
  ]);

  function walk(currentDir) {
    let entries;
    try { entries = readdirSync(currentDir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (REMOVE_DIRS.has(entry.name)) {
          try { rmSync(fullPath, { recursive: true, force: true }); removedCount++; } catch { /* */ }
        } else {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const name = entry.name;
        if (REMOVE_FILE_NAMES.has(name) || REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
          try { rmSync(fullPath, { force: true }); removedCount++; } catch { /* */ }
        }
      }
    }
  }

  walk(dir);
  return removedCount;
}

// ── Platform-specific: koffi ─────────────────────────────────────────────────
// koffi ships 18 platform pre-builds under koffi/build/koffi/{platform}_{arch}/.
// We only need the one matching the target.

function cleanupKoffi(nodeModulesDir, platform, arch) {
  const koffiDir = join(nodeModulesDir, 'koffi', 'build', 'koffi');
  if (!existsSync(koffiDir)) return 0;

  const keepTarget = `${platform}_${arch}`;
  let removed = 0;
  for (const entry of readdirSync(koffiDir)) {
    if (entry !== keepTarget) {
      try { rmSync(join(koffiDir, entry), { recursive: true, force: true }); removed++; } catch { /* */ }
    }
  }
  return removed;
}

// ── Platform-specific: scoped native packages ────────────────────────────────
// Packages like @napi-rs/canvas-darwin-arm64, @img/sharp-linux-x64, etc.
// Only the variant matching the target platform should survive.

const PLATFORM_NATIVE_SCOPES = {
  '@napi-rs': /^canvas-(darwin|linux|win32)-(x64|arm64)/,
  '@img': /^sharp(?:-libvips)?-(darwin|linux|win32)-(x64|arm64)/,
  '@mariozechner': /^clipboard-(darwin|linux|win32)-(x64|arm64|universal)/,
};

function cleanupNativePlatformPackages(nodeModulesDir, platform, arch) {
  let removed = 0;

  for (const [scope, pattern] of Object.entries(PLATFORM_NATIVE_SCOPES)) {
    const scopeDir = join(nodeModulesDir, scope);
    if (!existsSync(scopeDir)) continue;

    for (const entry of readdirSync(scopeDir)) {
      const match = entry.match(pattern);
      if (!match) continue; // not a platform-specific package, leave it

      const pkgPlatform = match[1];
      const pkgArch = match[2];

      const isMatch =
        pkgPlatform === platform &&
        (pkgArch === arch || pkgArch === 'universal');

      if (!isMatch) {
        try {
          rmSync(join(scopeDir, entry), { recursive: true, force: true });
          removed++;
        } catch { /* */ }
      }
    }
  }

  return removed;
}

function collectPluginSourceFiles(rootDir) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(normWin(dir), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      if (!/\.(ts|js|mjs|cjs)$/.test(entry.name)) continue;
      files.push(fullPath);
    }
  }
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
  let changedFiles = 0;

  for (const filePath of collectPluginSourceFiles(rootDir)) {
    const source = require('fs').readFileSync(normWin(filePath), 'utf8');
    let nextContent = source;
    let changed = false;

    for (const sourceSpec of [ROOT_PLUGIN_SDK_SPEC, COMPAT_PLUGIN_SDK_SPEC]) {
      const escapedSourceSpec = sourceSpec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const importPattern = new RegExp(`^(\\s*)import\\s+\\{([^}]+)\\}\\s+from\\s+["']${escapedSourceSpec}["'];?\\s*$`, 'gm');
      nextContent = nextContent.replace(importPattern, (match, indent, rawSpecifiers) => {
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
          lines.push(`${indent}import { ${remaining.join(', ')} } from "${sourceSpec}";`);
        }
        for (const [subpath, movedSpecifiers] of movedBySubpath.entries()) {
          lines.push(`${indent}import { ${movedSpecifiers.join(', ')} } from "${subpath}";`);
        }
        return lines.join('\n');
      });
    }

    if (!changed || nextContent === source) continue;
    require('fs').writeFileSync(normWin(filePath), nextContent, 'utf8');
    changedFiles++;
  }

  return changedFiles;
}

function hasIncompatiblePluginSdkImports(rootDir) {
  for (const filePath of collectPluginSourceFiles(rootDir)) {
    const source = require('fs').readFileSync(normWin(filePath), 'utf8');
    if (/openclaw\/plugin-sdk\/compat/.test(source)) {
      return true;
    }
    if (/resolvePreferredOpenClawTmpDir/.test(source) && /openclaw\/plugin-sdk/.test(source) && !/openclaw\/plugin-sdk\/infra-runtime/.test(source)) {
      return true;
    }
    const requireMatch = source.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']openclaw\/plugin-sdk(?:\/compat)?["']\s*\)/);
    if (requireMatch) {
      const alias = requireMatch[1];
      if (new RegExp(`\\b${alias}\\.resolvePreferredOpenClawTmpDir\\b`).test(source)) {
        return true;
      }
    }
  }
  return false;
}

// ── Broken module patcher ─────────────────────────────────────────────────────
// Some bundled packages have transpiled CJS that sets `module.exports = exports.default`
// without ever assigning `exports.default`, leaving module.exports === undefined.
// This causes `TypeError: Cannot convert undefined or null to object` in Node.js 22+
// ESM interop (translators.js hasOwnProperty call).  We patch these after copying.

const MODULE_PATCHES = {
  // node-domexception@1.0.0: index.js sets module.exports = undefined.
  // Node.js 18+ ships DOMException as a built-in; this shim re-exports it.
  'node-domexception/index.js': [
    "'use strict';",
    '// Shim: original transpiled file sets module.exports = exports.default (undefined).',
    '// Node.js 18+ has DOMException as a built-in global.',
    'const dom = globalThis.DOMException ||',
    '  class DOMException extends Error {',
    "    constructor(msg, name) { super(msg); this.name = name || 'Error'; }",
    '  };',
    'module.exports = dom;',
    'module.exports.DOMException = dom;',
    'module.exports.default = dom;',
  ].join('\n') + '\n',
};

function patchBrokenModules(nodeModulesDir) {
  const { writeFileSync } = require('fs');
  let count = 0;
  for (const [rel, content] of Object.entries(MODULE_PATCHES)) {
    const target = join(nodeModulesDir, rel);
    if (existsSync(target)) {
      writeFileSync(target, content, 'utf8');
      count++;
    }
  }
  if (count > 0) {
    console.log(`[after-pack] 🩹 Patched ${count} broken module(s) in ${nodeModulesDir}`);
  }
}

// ── Plugin bundler ───────────────────────────────────────────────────────────
// Bundles a single OpenClaw plugin (and its transitive deps) from node_modules
// directly into the packaged resources directory.  Mirrors the logic in
// bundle-openclaw-plugins.mjs so the packaged app is self-contained even when
// build/openclaw-plugins/ was not pre-generated.

function getVirtualStoreNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (dir !== dirname(dir)) {
    if (basename(dir) === 'node_modules') return dir;
    dir = dirname(dir);
  }
  return null;
}

function listPkgs(nodeModulesDir) {
  const result = [];
  const nDir = normWin(nodeModulesDir);
  if (!existsSync(nDir)) return result;
  for (const entry of readdirSync(nDir)) {
    if (entry === '.bin') continue;
    // Use original (non-normWin) join for the logical path stored in result.fullPath,
    // so callers can still call getVirtualStoreNodeModules() on it correctly.
    const fullPath = join(nodeModulesDir, entry);
    if (entry.startsWith('@')) {
      let subs;
      try { subs = readdirSync(normWin(fullPath)); } catch { continue; }
      for (const sub of subs) {
        result.push({ name: `${entry}/${sub}`, fullPath: join(fullPath, sub) });
      }
    } else {
      result.push({ name: entry, fullPath });
    }
  }
  return result;
}

function bundlePlugin(nodeModulesRoot, npmName, destDir) {
  const pkgPath = join(nodeModulesRoot, ...npmName.split('/'));
  if (!existsSync(pkgPath)) {
    console.warn(`[after-pack] ⚠️  Plugin package not found: ${pkgPath}. Run pnpm install.`);
    return false;
  }

  let realPluginPath;
  try { realPluginPath = realpathSync.native(pkgPath); } catch { realPluginPath = pkgPath; }

  // Copy plugin package itself
  if (existsSync(normWin(destDir))) rmSync(normWin(destDir), { recursive: true, force: true });
  mkdirSync(normWin(destDir), { recursive: true });
  cpSync(normWin(realPluginPath), normWin(destDir), { recursive: true, dereference: true });
  const repairedSourceFiles = repairPluginSdkRootImports(destDir);
  if (repairedSourceFiles > 0) {
    console.log(`[after-pack] 🔧 Repaired ${repairedSourceFiles} plugin-sdk import file(s) for ${npmName}`);
  }
  if (hasIncompatiblePluginSdkImports(destDir)) {
    throw new Error(`[after-pack] Bundled plugin ${npmName} still contains incompatible plugin-sdk imports after repair.`);
  }

  // Collect transitive deps via pnpm virtual store BFS
  const collectedByName = new Map();
  const discoveredRealPathsByName = new Map();
  const visitedRealPaths = new Set();
  const queue = [];

  const rootVirtualNM = getVirtualStoreNodeModules(realPluginPath);
  if (!rootVirtualNM) {
    console.warn(`[after-pack] ⚠️  Could not find virtual store for ${npmName}, skipping deps.`);
    return true;
  }
  queue.push({ nodeModulesDir: rootVirtualNM, skipPkg: npmName });

  // Read peerDependencies from the plugin's package.json so we don't bundle
  // packages that are provided by the host environment (e.g. openclaw itself).
  const SKIP_PACKAGES = new Set(['typescript', '@playwright/test']);
  const SKIP_SCOPES = ['@types/'];
  try {
    const pluginPkg = JSON.parse(
      require('fs').readFileSync(join(destDir, 'package.json'), 'utf8')
    );
    for (const peer of Object.keys(pluginPkg.peerDependencies || {})) {
      SKIP_PACKAGES.add(peer);
    }
  } catch { /* ignore */ }

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
        pkg = JSON.parse(require('fs').readFileSync(join(realPath, 'package.json'), 'utf8'));
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

        const nestedDest = join(issue.packageDir, 'node_modules', issue.dependencyName);
        try {
          rmSync(normWin(nestedDest), { recursive: true, force: true });
          mkdirSync(normWin(dirname(nestedDest)), { recursive: true });
          cpSync(normWin(candidateRealPath), normWin(nestedDest), { recursive: true, dereference: true });
          repairedThisPass++;
        } catch (e) {
          console.warn(`[after-pack]   Failed to repair ${issue.packageName} -> ${issue.dependencyName}: ${e.message}`);
        }
      }

      if (repairedThisPass === 0) break;
      totalRepairs += repairedThisPass;
    }

    return totalRepairs;
  }

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg } = queue.shift();
    for (const { name, fullPath } of listPkgs(nodeModulesDir)) {
      if (name === skipPkg) continue;
      if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some(s => name.startsWith(s))) continue;
      let rp;
      try { rp = realpathSync.native(fullPath); } catch { continue; }
      addDiscoveredPackage(name, rp);
      if (!collectedByName.has(name)) {
        collectedByName.set(name, rp);
      }
      if (visitedRealPaths.has(rp)) continue;
      visitedRealPaths.add(rp);
      const depVirtualNM = getVirtualStoreNodeModules(rp);
      if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
      }
    }
  }

  // Copy flattened deps into destDir/node_modules
  const destNM = join(destDir, 'node_modules');
  mkdirSync(destNM, { recursive: true });
  const copiedRealPathsByName = new Map();
  let count = 0;
  for (const [pkgName, rp] of collectedByName) {
    const d = join(destNM, pkgName);
    try {
      mkdirSync(normWin(dirname(d)), { recursive: true });
      cpSync(normWin(rp), normWin(d), { recursive: true, dereference: true });
      copiedRealPathsByName.set(pkgName, rp);
      count++;
    } catch (e) {
      console.warn(`[after-pack]   Skipped dep ${pkgName}: ${e.message}`);
    }
  }
  let preservedOverrides = 0;
  for (const [pkgName, pkgRealPath] of collectedByName) {
    if (copiedRealPathsByName.get(pkgName) !== pkgRealPath) continue;

    const packageDest = join(destNM, pkgName);
    if (!existsSync(normWin(packageDest))) continue;

    const depVirtualNM = getVirtualStoreNodeModules(pkgRealPath);
    if (!depVirtualNM) continue;

    for (const { name: depName, fullPath } of listPkgs(depVirtualNM)) {
      if (depName === pkgName) continue;
      if (SKIP_PACKAGES.has(depName) || SKIP_SCOPES.some(s => depName.startsWith(s))) continue;

      let depRealPath;
      try { depRealPath = realpathSync.native(fullPath); } catch { continue; }

      const topLevelRealPath = copiedRealPathsByName.get(depName);
      if (!topLevelRealPath || topLevelRealPath === depRealPath) continue;

      const nestedDest = join(packageDest, 'node_modules', depName);
      if (existsSync(normWin(nestedDest))) continue;

      try {
        mkdirSync(normWin(dirname(nestedDest)), { recursive: true });
        cpSync(normWin(depRealPath), normWin(nestedDest), { recursive: true, dereference: true });
        preservedOverrides++;
      } catch (e) {
        console.warn(`[after-pack]   Failed nested override ${pkgName} -> ${depName}: ${e.message}`);
      }
    }
  }
  const repairedDependencyIssues = repairBundledDependencyGraph(destNM);
  if (repairedDependencyIssues > 0) {
    console.log(`[after-pack] 🛠️  Plugin ${npmName}: repaired ${repairedDependencyIssues} dependency override(s)`);
  }
  console.log(`[after-pack] ✅ Plugin ${npmName}: copied ${count} deps to ${destDir} (preserved overrides: ${preservedOverrides})`);
  return true;
}

// ── Main hook ────────────────────────────────────────────────────────────────

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName; // 'win32' | 'darwin' | 'linux'
  const arch = resolveArch(context.arch);

  console.log(`[after-pack] Target: ${platform}/${arch}`);

  const src = join(__dirname, '..', 'build', 'openclaw', 'node_modules');

  let resourcesDir;
  if (platform === 'darwin') {
    const appName = context.packager.appInfo.productFilename;
    resourcesDir = join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  } else {
    resourcesDir = join(appOutDir, 'resources');
  }

  const openclawRoot = join(resourcesDir, 'openclaw');
  const dest = join(openclawRoot, 'node_modules');
  const nodeModulesRoot = join(__dirname, '..', 'node_modules');
  const pluginsDestRoot = join(resourcesDir, 'openclaw-plugins');

  if (!existsSync(src)) {
    console.warn('[after-pack] ⚠️  build/openclaw/node_modules not found. Run bundle-openclaw first.');
    return;
  }

  // 1. Copy node_modules (electron-builder skips it due to .gitignore)
  const depCount = readdirSync(src, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '.bin')
    .length;

  console.log(`[after-pack] Copying ${depCount} openclaw dependencies to ${dest} ...`);
  cpSync(normWin(src), normWin(dest), { recursive: true, dereference: true });
  console.log('[after-pack] ✅ openclaw node_modules copied.');

  // Patch broken modules whose CJS transpiled output sets module.exports = undefined,
  // causing TypeError in Node.js 22+ ESM interop.
  patchBrokenModules(dest);

  const dependencyIssues = validateBundledNodeModules(dest);
  if (dependencyIssues.length > 0) {
    throw new Error(
      `[after-pack] OpenClaw dependency validation failed:\n${formatValidationIssues(dependencyIssues).join('\n')}`
    );
  }

  // 1.1 Bundle OpenClaw plugins directly from node_modules into packaged resources.
  //     This is intentionally done in afterPack (not extraResources) because:
  //     - electron-builder silently skips extraResources entries whose source
  //       directory doesn't exist (build/openclaw-plugins/ may not be pre-generated)
  //     - node_modules/ is excluded by .gitignore so the deps copy must be manual
  const BUNDLED_PLUGINS = [
    { npmName: '@openclaw-china/channels', pluginId: 'channels' },
    { npmName: '@tencent-weixin/openclaw-weixin', pluginId: 'openclaw-weixin' },
  ];

  mkdirSync(pluginsDestRoot, { recursive: true });
  for (const { npmName, pluginId } of BUNDLED_PLUGINS) {
    const pluginDestDir = join(pluginsDestRoot, pluginId);
    console.log(`[after-pack] Bundling plugin ${npmName} -> ${pluginDestDir}`);
    const ok = bundlePlugin(nodeModulesRoot, npmName, pluginDestDir);
    if (ok) {
      const pluginNM = join(pluginDestDir, 'node_modules');
      cleanupUnnecessaryFiles(pluginDestDir);
      if (existsSync(pluginNM)) {
        cleanupKoffi(pluginNM, platform, arch);
        cleanupNativePlatformPackages(pluginNM, platform, arch);
      }
    }
  }

  // 2. General cleanup on the full openclaw directory (not just node_modules)
  console.log('[after-pack] 🧹 Cleaning up unnecessary files ...');
  const removedRoot = cleanupUnnecessaryFiles(openclawRoot);
  console.log(`[after-pack] ✅ Removed ${removedRoot} unnecessary files/directories.`);

  // 3. Platform-specific: strip koffi non-target platform binaries
  const koffiRemoved = cleanupKoffi(dest, platform, arch);
  if (koffiRemoved > 0) {
    console.log(`[after-pack] ✅ koffi: removed ${koffiRemoved} non-target platform binaries (kept ${platform}_${arch}).`);
  }

  // 4. Platform-specific: strip wrong-platform native packages
  const nativeRemoved = cleanupNativePlatformPackages(dest, platform, arch);
  if (nativeRemoved > 0) {
    console.log(`[after-pack] ✅ Removed ${nativeRemoved} non-target native platform packages.`);
  }

  // 5. Windows CLI runtime validation
  if (platform === 'win32') {
    const bundledNode = join(resourcesDir, 'bin', 'node.exe');
    const cliWrapper = join(resourcesDir, 'cli', 'openclaw.cmd');
    const cliEntry = join(resourcesDir, 'openclaw', 'openclaw.mjs');

    const missing = [];
    if (!existsSync(bundledNode)) missing.push(bundledNode);
    if (!existsSync(cliWrapper)) missing.push(cliWrapper);
    if (!existsSync(cliEntry)) missing.push(cliEntry);

    if (missing.length > 0) {
      throw new Error(
        `[after-pack] Windows CLI runtime is incomplete. Missing: ${missing.join(', ')}`
      );
    }

    console.log('[after-pack] ✅ Windows CLI runtime validated (node.exe + wrapper + entry script).');
  }
};
