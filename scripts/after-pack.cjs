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

const { cpSync, existsSync, readdirSync, rmSync, statSync, mkdirSync, writeFileSync, copyFileSync } = require('fs');
const { join, dirname } = require('path');
const {
  validateBundledNodeModules,
  formatValidationIssues,
} = require('./openclaw-bundle-validator.cjs');
const { bundlePluginMirror } = require('./openclaw-plugin-bundler.cjs');

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

function removeNodeModulesBinDirs(dir) {
  let removedCount = 0;

  function walk(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(currentDir, entry.name);

      if (entry.name === '.bin' && currentDir.endsWith('node_modules')) {
        try {
          rmSync(fullPath, { recursive: true, force: true });
          removedCount++;
        } catch {
          // ignore best-effort cleanup errors
        }
        continue;
      }

      walk(fullPath);
    }
  }

  walk(dir);
  return removedCount;
}

function listPackageEntries(nodeModulesDir) {
  if (!existsSync(nodeModulesDir)) return [];

  const entries = [];
  for (const entry of readdirSync(nodeModulesDir)) {
    if (entry === '.bin') continue;
    const entryPath = join(nodeModulesDir, entry);

    if (entry.startsWith('@')) {
      if (!existsSync(entryPath)) continue;
      for (const scoped of readdirSync(entryPath)) {
        const fullPath = join(entryPath, scoped);
        if (existsSync(join(fullPath, 'package.json'))) {
          entries.push(fullPath);
        }
      }
    } else if (existsSync(join(entryPath, 'package.json'))) {
      entries.push(entryPath);
    }
  }

  return entries;
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
  const { writeFileSync, readFileSync } = require('fs');
  let count = 0;
  for (const [rel, content] of Object.entries(MODULE_PATCHES)) {
    const target = join(nodeModulesDir, rel);
    if (existsSync(target)) {
      writeFileSync(target, content, 'utf8');
      count++;
    }
  }
  count += patchKnownDependencyMetadata(nodeModulesDir);
  if (count > 0) {
    console.log(`[after-pack] 🩹 Patched ${count} broken module(s) in ${nodeModulesDir}`);
  }
}

function patchKnownDependencyMetadata(nodeModulesDir) {
  let count = 0;
  const queue = [nodeModulesDir];
  const seen = new Set();

  while (queue.length > 0) {
    const currentNodeModules = queue.shift();
    if (!currentNodeModules || seen.has(currentNodeModules) || !existsSync(currentNodeModules)) continue;
    seen.add(currentNodeModules);

    for (const pkgDir of listPackageEntries(currentNodeModules)) {
      const pkgJsonPath = join(pkgDir, 'package.json');
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      } catch {
        pkg = null;
      }

      if (
        pkg?.name === 'p-queue' &&
        pkg?.version === '6.6.2' &&
        pkg?.dependencies?.['p-timeout'] === '^3.2.0'
      ) {
        pkg.dependencies['p-timeout'] = '^3.2.0 || ^4.0.0';
        writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        count++;
      }

      const nestedNodeModules = join(pkgDir, 'node_modules');
      if (existsSync(nestedNodeModules)) {
        queue.push(nestedNodeModules);
      }
    }
  }

  return count;
}

// ── Plugin bundler ───────────────────────────────────────────────────────────
function bundlePlugin(nodeModulesRoot, npmName, destDir) {
  const result = bundlePluginMirror({
    nodeModulesRoot,
    npmName,
    destDir,
    pluginLabel: npmName,
    missingPackageMode: 'warn-return-false',
    logger: {
      info: (message) => console.log(`[after-pack] ${message}`),
      warn: (message) => console.warn(`[after-pack] ⚠️  ${message}`),
    },
  });
  if (result === false) return false;
  console.log(
    `[after-pack] ✅ Plugin ${npmName}: copied ${result.copiedCount} deps to ${destDir} (skipped dupes: ${result.skippedDupes}, preserved overrides: ${result.preservedOverrides})`
  );
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

  const removedBinDirs = removeNodeModulesBinDirs(openclawRoot);
  if (removedBinDirs > 0) {
    console.log(`[after-pack] ✅ Removed ${removedBinDirs} nested node_modules/.bin director${removedBinDirs === 1 ? 'y' : 'ies'}.`);
  }

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

  // 6. Portable mode marker — place .portable at the portable root so the app
  // detects portable mode when the directory is copied to a USB drive and run.
  // On macOS appOutDir is <dir>/ClawClaw.app/, so .portable goes alongside the
  // .app bundle (the parent of appOutDir). On Windows appOutDir is <dir>/ and
  // .portable goes directly inside it.
  try {
    const isMacAppBundle = platform === 'darwin' && appOutDir.endsWith('.app' + sep);
    const portableDir = isMacAppBundle ? dirname(appOutDir) : appOutDir;
    const portableMarker = join(portableDir, '.portable');
    writeFileSync(portableMarker, '', 'utf8');
    console.log(`[after-pack] ✅ Portable marker created at ${portableMarker}`);
  } catch (err) {
    console.warn(`[after-pack] ⚠️  Failed to create portable marker: ${err.message}`);
  }

  // 7. Copy portable launcher scripts to the portable root directory.
  // Windows: next to ClawClaw.exe (appOutDir = win-unpacked/).
  // macOS: next to ClawClaw.app (portableDir = parent of appOutDir).
  {
    const isMacBundle = platform === 'darwin' && appOutDir.endsWith('.app' + sep);
    const destRoot = isMacBundle ? dirname(appOutDir) : appOutDir;
    const srcDir = join(__dirname, '..', 'resources');

    if (platform === 'win32') {
      const launchers = ['Start ClawClaw.bat', 'Start ClawClaw.vbs', 'README Portable.txt'];
      for (const name of launchers) {
        try { copyFileSync(join(srcDir, name), join(destRoot, name)); } catch { /* */ }
      }
    }

    if (platform === 'darwin') {
      const scriptName = 'Start ClawClaw.command';
      const dest = join(destRoot, scriptName);
      try {
        copyFileSync(join(srcDir, scriptName), dest);
        // Ensure executable permission (macOS zip strips executable bits on files from USB).
        try { require('child_process').execSync(`chmod +x "${dest}"`, { stdio: 'ignore' }); } catch { /* */ }
        console.log(`[after-pack] ✅ Copied ${scriptName} to portable root with +x`);
      } catch { /* */ }

      try {
        copyFileSync(join(srcDir, 'README Portable.txt'), join(destRoot, 'README Portable.txt'));
      } catch { /* */ }
    }
  }
};
