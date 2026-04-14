#!/usr/bin/env zx

/**
 * bundle-openclaw.mjs
 *
 * Bundles the openclaw npm package with ALL its dependencies (including
 * transitive ones) into a self-contained directory (build/openclaw/) for
 * electron-builder to pick up.
 *
 * pnpm uses a content-addressable virtual store with symlinks. A naive copy
 * of node_modules/openclaw/ will miss runtime dependencies entirely. Even
 * copying only direct siblings misses transitive deps (e.g. @clack/prompts
 * depends on @clack/core which lives in a separate virtual store entry).
 *
 * This script performs a recursive BFS through pnpm's virtual store to
 * collect every transitive dependency into a flat node_modules structure.
 */

import 'zx/globals';
import semver from 'semver';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import bundleValidator from './openclaw-bundle-validator.cjs';

const {
  parseDependencySpec,
  isCheckableRange,
  validateBundledNodeModules,
  formatValidationIssues,
} = bundleValidator;

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'build', 'openclaw');
const BUNDLE_META_PATH = path.join(OUTPUT, '.bundle-meta.json');
const RUNTIME_DEPS_CACHE_ROOT = path.join(ROOT, 'build', 'cache', 'bundled-plugin-runtime');
const RUNTIME_DEPS_CACHE_NODE_MODULES = path.join(RUNTIME_DEPS_CACHE_ROOT, 'node_modules');
const BUNDLED_PLUGIN_REGISTRY =
  process.env.OPENCLAW_BUNDLED_PLUGIN_REGISTRY || 'https://registry.npmjs.org/';
const NODE_MODULES = path.join(ROOT, 'node_modules');
const FORCE_REBUILD = process.argv.includes('--force') || process.env.OPENCLAW_BUNDLE_FORCE === '1';

// On Windows, pnpm virtual store paths can exceed MAX_PATH (260 chars).
function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function computeBundleCacheKey(openclawReal) {
  const hash = createHash('sha256');
  hash.update('bundle-openclaw-cache-v1\n');
  hash.update(readTextIfExists(path.join(ROOT, 'pnpm-lock.yaml')));
  hash.update('\n--- package.json ---\n');
  hash.update(readTextIfExists(path.join(ROOT, 'package.json')));
  hash.update('\n--- openclaw package.json ---\n');
  hash.update(readTextIfExists(path.join(openclawReal, 'package.json')));
  hash.update('\n--- bundler script ---\n');
  hash.update(readTextIfExists(__filename));
  return hash.digest('hex');
}

function readBundleMeta() {
  try {
    return JSON.parse(fs.readFileSync(BUNDLE_META_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function outputBundleLooksReusable() {
  return fs.existsSync(path.join(OUTPUT, 'package.json'))
    && fs.existsSync(path.join(OUTPUT, 'openclaw.mjs'))
    && fs.existsSync(path.join(OUTPUT, 'dist', 'entry.js'))
    && fs.existsSync(path.join(OUTPUT, 'node_modules'));
}

echo`📦 Bundling openclaw for electron-builder...`;

// 1. Resolve the real path of node_modules/openclaw (follows pnpm symlink)
const openclawLink = path.join(NODE_MODULES, 'openclaw');
if (!fs.existsSync(openclawLink)) {
  echo`❌ node_modules/openclaw not found. Run pnpm install first.`;
  process.exit(1);
}

// realpath on Windows can mis-handle extended-length prefixes (\\?\) in
// some Node versions; resolve symlinks using the native path form.
const openclawReal = fs.realpathSync.native(openclawLink);
echo`   openclaw resolved: ${openclawReal}`;
const openclawBundledPluginPostinstallScript = path.join(openclawReal, 'scripts', 'postinstall-bundled-plugins.mjs');
const openclawNpmRunnerScript = path.join(openclawReal, 'scripts', 'npm-runner.mjs');
const bundleCacheKey = computeBundleCacheKey(openclawReal);
const existingBundleMeta = readBundleMeta();

if (!FORCE_REBUILD && existingBundleMeta?.cacheKey === bundleCacheKey && outputBundleLooksReusable()) {
  echo`   Reusing cached OpenClaw bundle at ${OUTPUT}`;
  echo`   Cache key: ${bundleCacheKey.slice(0, 12)}…`;
  process.exit(0);
}

// 2. Clean and create output directory
if (fs.existsSync(OUTPUT)) {
  fs.rmSync(OUTPUT, { recursive: true });
}
fs.mkdirSync(OUTPUT, { recursive: true });

// 3. Copy openclaw package itself to OUTPUT root
echo`   Copying openclaw package...`;
fs.cpSync(openclawReal, OUTPUT, { recursive: true, dereference: true });

// The copied package may include pnpm-linked node_modules entries from the
// source install. We rebuild OUTPUT/node_modules ourselves below, so drop the
// copied tree first to avoid leaking symlinks back to the developer machine.
const copiedRootNodeModules = path.join(OUTPUT, 'node_modules');
if (fs.existsSync(copiedRootNodeModules)) {
  fs.rmSync(copiedRootNodeModules, { recursive: true, force: true });
}

// 4. Recursively collect ALL transitive dependencies via pnpm virtual store BFS
//
// pnpm structure example:
//   .pnpm/openclaw@ver/node_modules/
//     openclaw/          <- real files
//     chalk/             <- symlink -> .pnpm/chalk@ver/node_modules/chalk
//     @clack/prompts/    <- symlink -> .pnpm/@clack+prompts@ver/node_modules/@clack/prompts
//
//   .pnpm/@clack+prompts@ver/node_modules/
//     @clack/prompts/    <- real files
//     @clack/core/       <- symlink (transitive dep, NOT in openclaw's siblings!)
//
// We BFS from openclaw's virtual store node_modules, following each symlink
// to discover the target's own virtual store node_modules and its deps.

const collectedByName = new Map(); // pkgName -> realPath (first retained version)
const discoveredRealPathsByName = new Map(); // pkgName -> Set<realPath>
const visitedRealPaths = new Set(); // real paths already traversed for BFS
const queue = []; // BFS queue of virtual-store node_modules dirs to visit

function addDiscoveredPackage(pkgName, realPath) {
  let realPaths = discoveredRealPathsByName.get(pkgName);
  if (!realPaths) {
    realPaths = new Set();
    discoveredRealPathsByName.set(pkgName, realPaths);
  }
  realPaths.add(realPath);
}

/**
 * Given a real path of a package, find the containing virtual-store node_modules.
 * e.g. .pnpm/chalk@5.4.1/node_modules/chalk -> .pnpm/chalk@5.4.1/node_modules
 * e.g. .pnpm/@clack+core@0.4.1/node_modules/@clack/core -> .pnpm/@clack+core@0.4.1/node_modules
 */
function getVirtualStoreNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * List all package entries in a virtual-store node_modules directory.
 * Handles both regular packages (chalk) and scoped packages (@clack/prompts).
 * Returns array of { name, fullPath }.
 */
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
      try {
        const scopeEntries = fs.readdirSync(normWin(entryPath));
        for (const sub of scopeEntries) {
          result.push({
            name: `${entry}/${sub}`,
            fullPath: path.join(entryPath, sub),
          });
        }
      } catch {
        // Not a directory, skip
      }
    } else {
      result.push({ name: entry, fullPath: entryPath });
    }
  }
  return result;
}

// Start BFS from openclaw's virtual store node_modules
const openclawVirtualNM = getVirtualStoreNodeModules(openclawReal);
if (!openclawVirtualNM) {
  echo`❌ Could not determine pnpm virtual store for openclaw`;
  process.exit(1);
}

echo`   Virtual store root: ${openclawVirtualNM}`;
queue.push({ nodeModulesDir: openclawVirtualNM, skipPkg: 'openclaw' });

const SKIP_PACKAGES = new Set([
  'typescript',
  '@playwright/test',
]);
const SKIP_SCOPES = ['@cloudflare/', '@types/'];
let skippedDevCount = 0;
let skippedDupes = 0;

while (queue.length > 0) {
  const { nodeModulesDir, skipPkg } = queue.shift();
  const packages = listPackages(nodeModulesDir);

  for (const { name, fullPath } of packages) {
    // Skip the package that owns this virtual store entry (it's the package itself, not a dep)
    if (name === skipPkg) continue;

    if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some(s => name.startsWith(s))) {
      skippedDevCount++;
      continue;
    }

    let realPath;
    try {
      realPath = fs.realpathSync.native(fullPath);
    } catch {
      continue; // broken symlink, skip
    }

    const retainedRealPath = collectedByName.get(name);
    addDiscoveredPackage(name, realPath);
    if (retainedRealPath == null) {
      collectedByName.set(name, realPath);
    } else if (retainedRealPath !== realPath) {
      skippedDupes++;
    }

    if (visitedRealPaths.has(realPath)) continue; // already traversed
    visitedRealPaths.add(realPath);

    // Find this package's own virtual store node_modules to discover ITS deps
    const depVirtualNM = getVirtualStoreNodeModules(realPath);
    if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
      // Determine the package's "self name" in its own virtual store
      // For scoped: @clack/core -> skip "@clack/core" when scanning
      queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
    }
  }
}

echo`   Found ${collectedByName.size} package names across ${visitedRealPaths.size} real packages`;
echo`   Skipped ${skippedDevCount} dev-only package references`;

// 5. Copy all collected packages into OUTPUT/node_modules/ (flat structure)
//
// IMPORTANT: BFS guarantees direct deps are encountered before transitive deps.
// When the same package name appears at different versions (e.g. chalk@5 from
// openclaw directly, chalk@4 from a transitive dep), we keep the FIRST one
// (direct dep version) and skip later duplicates. This prevents version
// conflicts like CJS chalk@4 overwriting ESM chalk@5.
const outputNodeModules = path.join(OUTPUT, 'node_modules');
fs.mkdirSync(outputNodeModules, { recursive: true });

const copiedRealPathsByName = new Map(); // pkg name -> real path retained at top level
let copiedCount = 0;

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

// 5.1 Preserve package-local dependency overrides for version conflicts.
//
// Flat copying keeps only the first version for a package name. That is good
// for size, but incorrect when a package needs a different major than the
// version retained at the top level. In those cases we recreate the package's
// own node_modules override, but only for the conflicting deps.
let preservedOverrides = 0;
for (const [pkgName, pkgRealPath] of collectedByName) {
  if (copiedRealPathsByName.get(pkgName) !== pkgRealPath) continue;

  // Only preserve nested overrides for the package version that we actually
  // retained at the top level.  Older versions with the same package name may
  // still exist in the dependency graph, but copying their nested deps into the
  // retained package directory corrupts the runtime tree.
  const packageDest = path.join(outputNodeModules, pkgName);
  if (!fs.existsSync(normWin(packageDest))) continue;

  const depVirtualNM = getVirtualStoreNodeModules(pkgRealPath);
  if (!depVirtualNM) continue;

  for (const { name: depName, fullPath } of listPackages(depVirtualNM)) {
    if (depName === pkgName) continue;
    if (SKIP_PACKAGES.has(depName) || SKIP_SCOPES.some(s => depName.startsWith(s))) continue;

    let depRealPath;
    try {
      depRealPath = fs.realpathSync.native(fullPath);
    } catch {
      continue;
    }

    const topLevelRealPath = copiedRealPathsByName.get(depName);
    if (!topLevelRealPath || topLevelRealPath === depRealPath) continue;

    // Check if the top-level version satisfies this package's own dependency range.
    // If the top-level version works, we don't need a nested override.
    // If it doesn't work, we MUST copy the package's own version as a nested override.
    const pkgJson = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(pkgRealPath, 'package.json'), 'utf8')); }
      catch { return null; }
    })();
    if (pkgJson) {
      const depRange = (pkgJson.dependencies || {})[depName];
      if (depRange) {
        const depSpec = parseDependencySpec(depRange);
        if (depSpec && isCheckableRange(depSpec)) {
          const topPkgJson = (() => {
            try { return JSON.parse(fs.readFileSync(path.join(topLevelRealPath, 'package.json'), 'utf8')); }
            catch { return null; }
          })();
          if (topPkgJson && semver.satisfies(topPkgJson.version || '0.0.0', depSpec.range, { includePrerelease: true, loose: true })) {
            // Top-level version is compatible — no need for a nested override
            continue;
          }
        }
      }
    }

    const nestedDest = path.join(packageDest, 'node_modules', depName);
    if (fs.existsSync(normWin(nestedDest))) continue;

    try {
      fs.mkdirSync(normWin(path.dirname(nestedDest)), { recursive: true });
      fs.cpSync(normWin(depRealPath), normWin(nestedDest), { recursive: true, dereference: true });
      preservedOverrides++;
    } catch (err) {
      echo`   ⚠️  Failed to preserve nested override ${pkgName} -> ${depName}: ${err.message}`;
    }
  }
}

function selectCompatibleRealPath(pkgName, rawRange) {
  const spec = parseDependencySpec(rawRange);
  const check = (pkgJson) => {
    if (!pkgJson) return false;
    if (spec.type === 'alias' && spec.aliasTarget && pkgJson.name !== pkgName && pkgJson.name !== spec.aliasTarget) return false;
    if (!isCheckableRange(spec)) return true;
    return semver.satisfies(pkgJson.version || '0.0.0', spec.range, { includePrerelease: true, loose: true });
  };

  // 1. Candidates from BFS discovery (first-discovered version takes priority)
  for (const realPath of (discoveredRealPathsByName.get(pkgName) || [])) {
    let pkgJson;
    try { pkgJson = JSON.parse(fs.readFileSync(path.join(realPath, 'package.json'), 'utf8')); }
    catch { continue; }
    if (check(pkgJson)) return realPath;
  }

  // 2. Any version of this package already in the bundle (nested overrides,
  // preserveOverrides copies, etc.). These may not be in discoveredRealPathsByName.
  const bundlePkgPaths = [];
  const scanStack = [outputNodeModules];
  while (scanStack.length > 0) {
    const dir = scanStack.shift();
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      if (entry === '.bin' || entry === pkgName) continue;
      const full = path.join(dir, entry);
      const nestedNM = path.join(full, 'node_modules');
      if (fs.existsSync(nestedNM)) {
        scanStack.push(nestedNM);
      }
    }
    // Is this a node_modules directory? Check if it contains our package.
    const pkgInDir = path.join(dir, pkgName);
    if (fs.existsSync(pkgInDir)) {
      bundlePkgPaths.push(pkgInDir);
    }
  }

  for (const realPath of bundlePkgPaths) {
    let pkgJson;
    try { pkgJson = JSON.parse(fs.readFileSync(path.join(realPath, 'package.json'), 'utf8')); }
    catch { continue; }
    if (check(pkgJson)) return realPath;
  }

  // 3. Bundled extension-local dependencies under dist/extensions/*/node_modules.
  // These packages are copied with OpenClaw's built-in extensions but may not be
  // reachable from the bundle root unless we explicitly lift or preserve them.
  const bundledExtensionRoots = [];
  const bundledExtensionsDir = path.join(OUTPUT, 'dist', 'extensions');
  if (fs.existsSync(bundledExtensionsDir)) {
    try {
      for (const entry of fs.readdirSync(bundledExtensionsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const extNodeModules = path.join(bundledExtensionsDir, entry.name, 'node_modules');
        if (fs.existsSync(extNodeModules)) {
          bundledExtensionRoots.push(extNodeModules);
        }
      }
    } catch {
      // ignore
    }
  }

  const searchQueue = [...bundledExtensionRoots];
  const visitedNodeModules = new Set();
  while (searchQueue.length > 0) {
    const currentNodeModules = searchQueue.shift();
    if (!currentNodeModules || visitedNodeModules.has(currentNodeModules)) continue;
    visitedNodeModules.add(currentNodeModules);

    const pkgPath = path.join(currentNodeModules, pkgName);
    if (fs.existsSync(pkgPath)) {
      let pkgJson;
      try { pkgJson = JSON.parse(fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf8')); }
      catch { pkgJson = null; }
      if (check(pkgJson)) return pkgPath;
    }

    let packages = [];
    try { packages = listPackages(currentNodeModules); } catch { packages = []; }
    for (const { fullPath } of packages) {
      const nestedNodeModules = path.join(fullPath, 'node_modules');
      if (fs.existsSync(nestedNodeModules)) {
        searchQueue.push(nestedNodeModules);
      }
    }
  }

  // 4. Reusable cache for bundled plugin runtime dependencies.
  if (fs.existsSync(RUNTIME_DEPS_CACHE_NODE_MODULES)) {
    const cachedPkgPath = path.join(RUNTIME_DEPS_CACHE_NODE_MODULES, pkgName);
    if (fs.existsSync(cachedPkgPath)) {
      let pkgJson;
      try { pkgJson = JSON.parse(fs.readFileSync(path.join(cachedPkgPath, 'package.json'), 'utf8')); }
      catch { pkgJson = null; }
      if (check(pkgJson)) return cachedPkgPath;
    }

    const cacheQueue = [RUNTIME_DEPS_CACHE_NODE_MODULES];
    const visitedCacheNodeModules = new Set();
    while (cacheQueue.length > 0) {
      const currentNodeModules = cacheQueue.shift();
      if (!currentNodeModules || visitedCacheNodeModules.has(currentNodeModules)) continue;
      visitedCacheNodeModules.add(currentNodeModules);

      const candidate = path.join(currentNodeModules, pkgName);
      if (fs.existsSync(candidate)) {
        let pkgJson;
        try { pkgJson = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8')); }
        catch { pkgJson = null; }
        if (check(pkgJson)) return candidate;
      }

      let packages = [];
      try { packages = listPackages(currentNodeModules); } catch { packages = []; }
      for (const { fullPath } of packages) {
        const nestedNodeModules = path.join(fullPath, 'node_modules');
        if (fs.existsSync(nestedNodeModules)) cacheQueue.push(nestedNodeModules);
      }
    }
  }

  return null;
}

function resolveExtensionDependencyRealPath(pkgName, rawRange) {
  const spec = parseDependencySpec(rawRange);
  const bundledExtensionsDir = path.join(OUTPUT, 'dist', 'extensions');
  if (!fs.existsSync(bundledExtensionsDir)) return null;

  const check = (pkgJson) => {
    if (!pkgJson) return false;
    if (spec?.type === 'alias' && spec.aliasTarget && pkgJson.name !== pkgName && pkgJson.name !== spec.aliasTarget) {
      return false;
    }
    if (!isCheckableRange(spec)) return true;
    return semver.satisfies(pkgJson.version || '0.0.0', spec.range, { includePrerelease: true, loose: true });
  };

  const queue = [];
  const visited = new Set();
  try {
    for (const entry of fs.readdirSync(bundledExtensionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const extNodeModules = path.join(bundledExtensionsDir, entry.name, 'node_modules');
      if (fs.existsSync(extNodeModules)) queue.push(extNodeModules);
    }
  } catch {
    return null;
  }

  while (queue.length > 0) {
    const currentNodeModules = queue.shift();
    if (!currentNodeModules || visited.has(currentNodeModules)) continue;
    visited.add(currentNodeModules);

    const candidate = path.join(currentNodeModules, ...pkgName.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      let pkgJson;
      try { pkgJson = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8')); }
      catch { pkgJson = null; }
      if (check(pkgJson)) return candidate;
    }

    let packages = [];
    try { packages = listPackages(currentNodeModules); } catch { packages = []; }
    for (const { fullPath } of packages) {
      const nestedNodeModules = path.join(fullPath, 'node_modules');
      if (fs.existsSync(nestedNodeModules)) queue.push(nestedNodeModules);
    }
  }

  return null;
}

function backfillDependencyIssuesFromExtensions(issues) {
  let backfilled = 0;

  for (const issue of issues) {
    if (issue.type !== 'missing' && issue.type !== 'version-mismatch' && issue.type !== 'alias-mismatch') {
      continue;
    }

    const candidateRealPath = resolveExtensionDependencyRealPath(issue.dependencyName, issue.requestedRange);
    if (!candidateRealPath) continue;

    const nestedDest = path.join(issue.packageDir, 'node_modules', issue.dependencyName);
    try {
      fs.rmSync(normWin(nestedDest), { recursive: true, force: true });
      fs.mkdirSync(normWin(path.dirname(nestedDest)), { recursive: true });
      fs.cpSync(normWin(candidateRealPath), normWin(nestedDest), { recursive: true, dereference: true });
      backfilled++;
    } catch {
      // best effort
    }
  }

  return backfilled;
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

const repairedDependencyIssues = repairBundledDependencyGraph(outputNodeModules);
if (repairedDependencyIssues > 0) {
  echo`   🛠️  Repaired ${repairedDependencyIssues} bundled dependency override(s)`;
}

// 5b. Merge built-in extension node_modules into top-level node_modules
//
// OpenClaw ships built-in extensions under dist/extensions/<ext>/node_modules/.
// Some shared chunks in dist/ import extension-specific packages like "grammy"
// directly, and Node's ESM resolver only walks upward from the importing file.
// It does not search dist/extensions/<ext>/node_modules, so we need those deps
// available from the bundle root.
const BUILTIN_EXTENSION_RUNTIME_PACKAGES = new Set([
  'grammy',
  '@grammyjs/runner',
  '@grammyjs/transformer-throttler',
]);
const extensionsDir = path.join(OUTPUT, 'dist', 'extensions');
let mergedExtensionDepCount = 0;
if (fs.existsSync(extensionsDir)) {
  for (const extEntry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!extEntry.isDirectory()) continue;
    const extNodeModules = path.join(extensionsDir, extEntry.name, 'node_modules');
    if (!fs.existsSync(extNodeModules)) continue;

    const extensionPackages = new Map();
    for (const pkgEntry of fs.readdirSync(extNodeModules, { withFileTypes: true })) {
      if (pkgEntry.name === '.bin') continue;
      const srcPkg = path.join(extNodeModules, pkgEntry.name);

      if (pkgEntry.name.startsWith('@')) {
        let scopeEntries;
        try {
          scopeEntries = fs.readdirSync(srcPkg, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const scopeEntry of scopeEntries) {
          if (!scopeEntry.isDirectory()) continue;
          extensionPackages.set(`${pkgEntry.name}/${scopeEntry.name}`, path.join(srcPkg, scopeEntry.name));
        }
        continue;
      }

      if (pkgEntry.isDirectory()) {
        extensionPackages.set(pkgEntry.name, srcPkg);
      }
    }

    const mergeQueue = [...BUILTIN_EXTENSION_RUNTIME_PACKAGES];
    const enqueued = new Set(mergeQueue);
    while (mergeQueue.length > 0) {
      const pkgName = mergeQueue.shift();
      const srcPkg = extensionPackages.get(pkgName);
      if (!srcPkg) continue;

      let pkgJson = null;
      try {
        pkgJson = JSON.parse(fs.readFileSync(path.join(srcPkg, 'package.json'), 'utf8'));
      } catch {
        pkgJson = null;
      }

      if (!copiedRealPathsByName.has(pkgName)) {
        const dest = path.join(outputNodeModules, pkgName);
        try {
          fs.mkdirSync(normWin(path.dirname(dest)), { recursive: true });
          fs.cpSync(normWin(srcPkg), normWin(dest), { recursive: true, dereference: true });
          copiedRealPathsByName.set(pkgName, srcPkg);
          mergedExtensionDepCount++;
        } catch {
          // non-fatal
        }
      }

      for (const depName of Object.keys(pkgJson?.dependencies || {})) {
        if (enqueued.has(depName)) continue;
        if (!extensionPackages.has(depName)) continue;
        enqueued.add(depName);
        mergeQueue.push(depName);
      }
    }
  }
}
if (mergedExtensionDepCount > 0) {
  echo`   📎 Merged ${mergedExtensionDepCount} built-in extension runtime dependencies`;
  const repairedAfterExtensionMerge = repairBundledDependencyGraph(outputNodeModules);
  if (repairedAfterExtensionMerge > 0) {
    echo`   🛠️  Repaired ${repairedAfterExtensionMerge} dependency override(s) after extension merge`;
  }
}

async function stageBundledPluginRuntimeDeps(packageRoot) {
  if (!fs.existsSync(openclawBundledPluginPostinstallScript)) {
    echo`   ⚠️  Skipped bundled plugin runtime deps staging: postinstall script not found`;
    return;
  }

  const { createNestedNpmInstallEnv, discoverBundledPluginRuntimeDeps } = await import(
    pathToFileURL(openclawBundledPluginPostinstallScript).href
  );
  const { resolveNpmRunner } = await import(pathToFileURL(openclawNpmRunnerScript).href);

  const extensionsDir = path.join(packageRoot, 'dist', 'extensions');
  const extensionRuntimeDepRoots = fs.existsSync(extensionsDir)
    ? fs
        .readdirSync(extensionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(extensionsDir, entry.name, 'node_modules'))
        .filter((dir) => fs.existsSync(dir))
    : [];

  const ensureRuntimeDepsCacheRoot = () => {
    fs.mkdirSync(RUNTIME_DEPS_CACHE_ROOT, { recursive: true });
    const cachePackageJson = path.join(RUNTIME_DEPS_CACHE_ROOT, 'package.json');
    if (!fs.existsSync(cachePackageJson)) {
      fs.writeFileSync(
        cachePackageJson,
        `${JSON.stringify({ name: 'clawx-bundled-plugin-runtime-cache', private: true }, null, 2)}\n`,
        'utf8'
      );
    }
  };

  const getRuntimeDepSourceRoots = () => {
    const roots = [...extensionRuntimeDepRoots];
    if (fs.existsSync(RUNTIME_DEPS_CACHE_NODE_MODULES)) {
      roots.push(RUNTIME_DEPS_CACHE_NODE_MODULES);
    }
    return roots;
  };

  const findPackageInNodeModulesTree = (nodeModulesRoot, pkgName, rawRange = null) => {
    const spec = rawRange == null ? null : parseDependencySpec(rawRange);
    const matchesSpec = (pkgJson) => {
      if (!pkgJson) return false;
      if (spec?.type === 'alias' && spec.aliasTarget && pkgJson.name !== pkgName && pkgJson.name !== spec.aliasTarget) {
        return false;
      }
      if (!isCheckableRange(spec)) return true;
      return semver.satisfies(pkgJson.version || '0.0.0', spec.range, { includePrerelease: true, loose: true });
    };

    const queue = [nodeModulesRoot];
    const visited = new Set();
    const packageSegments = pkgName.split('/');

    while (queue.length > 0) {
      const currentNodeModules = queue.shift();
      if (!currentNodeModules || visited.has(currentNodeModules)) continue;
      visited.add(currentNodeModules);

      const candidate = path.join(currentNodeModules, ...packageSegments);
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        let pkgJson;
        try { pkgJson = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8')); }
        catch { pkgJson = null; }
        if (matchesSpec(pkgJson)) {
          return candidate;
        }
      }

      let packages;
      try {
        packages = listPackages(currentNodeModules);
      } catch {
        continue;
      }

      for (const { fullPath } of packages) {
        const nestedNodeModules = path.join(fullPath, 'node_modules');
        if (fs.existsSync(nestedNodeModules)) {
          queue.push(nestedNodeModules);
        }
      }
    }

    return null;
  };

  const stageRuntimeDepFromSourceRoots = (depName, rawRange = null) => {
    for (const sourceRoot of getRuntimeDepSourceRoots()) {
      const sourcePkg = findPackageInNodeModulesTree(sourceRoot, depName, rawRange);
      if (!sourcePkg) continue;

      const destPkg = path.join(packageRoot, 'node_modules', ...depName.split('/'));
      if (fs.existsSync(path.join(destPkg, 'package.json'))) {
        return sourcePkg;
      }

      try {
        fs.mkdirSync(normWin(path.dirname(destPkg)), { recursive: true });
        fs.cpSync(normWin(sourcePkg), normWin(destPkg), { recursive: true, dereference: true });
        copiedRealPathsByName.set(depName, sourcePkg);
        return sourcePkg;
      } catch (err) {
        echo`   ⚠️  Failed to stage ${depName} from built-in extensions: ${err.message}`;
      }
    }

    return null;
  };

  const stageMissingRuntimeDepsFromSourceRoots = (runtimeDeps) => {
    let stagedCount = 0;
    for (const dep of runtimeDeps) {
      if (stageRuntimeDepFromSourceRoots(dep.name, dep.version)) {
        stagedCount++;
      }
    }
    if (stagedCount > 0) {
      const repairedAfterLocalStage = repairBundledDependencyGraph(outputNodeModules);
      if (repairedAfterLocalStage > 0) {
        echo`   🛠️  Repaired ${repairedAfterLocalStage} dependency override(s) after local plugin staging`;
      }
    }
    return stagedCount;
  };

  const installPackageSpecs = (specs) => {
    const parsedSpecs = [...new Set(specs)]
      .map((specText) => {
        const atIndex = specText.lastIndexOf('@');
        return {
          raw: specText,
          name: specText.slice(0, atIndex),
          range: specText.slice(atIndex + 1),
        };
      })
      .filter((spec) => spec.name && spec.range);

    const specsToInstall = parsedSpecs
      .filter((spec) => !findPackageInNodeModulesTree(RUNTIME_DEPS_CACHE_NODE_MODULES, spec.name, spec.range))
      .map((spec) => spec.raw)
      .sort();

    if (specsToInstall.length === 0) return false;
    ensureRuntimeDepsCacheRoot();

    const nestedEnv = createNestedNpmInstallEnv({
      ...process.env,
      npm_config_registry: BUNDLED_PLUGIN_REGISTRY,
      NPM_CONFIG_REGISTRY: BUNDLED_PLUGIN_REGISTRY,
      OPENCLAW_NO_RESPAWN: '1',
    });
    const npmRunner = resolveNpmRunner({
      env: nestedEnv,
      execPath: process.execPath,
      existsSync: fs.existsSync,
      npmArgs: ['install', '--omit=dev', '--no-save', '--package-lock=false', ...specsToInstall],
    });

    const result = spawnSync(npmRunner.command, npmRunner.args, {
      cwd: RUNTIME_DEPS_CACHE_ROOT,
      encoding: 'utf8',
      env: npmRunner.env ?? nestedEnv,
      stdio: 'pipe',
      shell: npmRunner.shell,
      windowsVerbatimArguments: npmRunner.windowsVerbatimArguments,
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    if (result.status !== 0) {
      const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      throw new Error(output || `npm install failed for ${specsToInstall.join(', ')}`);
    }

    echo`   📦 Installed supplemental dependency specs into cache: ${specsToInstall.join(', ')}`;
    return true;
  };

  const findMissingRuntimeDeps = () => {
    const runtimeDeps = discoverBundledPluginRuntimeDeps({
      extensionsDir,
      existsSync: fs.existsSync,
    });
    return runtimeDeps.filter((dep) => !fs.existsSync(path.join(packageRoot, dep.sentinelPath)));
  };

  let missingBefore = findMissingRuntimeDeps();
  if (missingBefore.length === 0) {
    return;
  }

  let stagedFromExtensions = stageMissingRuntimeDepsFromSourceRoots(missingBefore);
  if (stagedFromExtensions > 0) {
    echo`   📎 Staged ${stagedFromExtensions} bundled plugin runtime deps from local sources`;
    missingBefore = findMissingRuntimeDeps();
  }

  if (missingBefore.length === 0) {
    return;
  }

  const missingSpecs = missingBefore.map((dep) => `${dep.name}@${dep.version}`);
  echo`   📦 Syncing bundled plugin runtime deps into cache: ${missingSpecs.join(', ')}`;
  echo`   🌐 Using bundled plugin registry: ${BUNDLED_PLUGIN_REGISTRY}`;
  installPackageSpecs(missingSpecs);

  let missingAfter = findMissingRuntimeDeps();
  const restagedAfterInstall = stageMissingRuntimeDepsFromSourceRoots(missingAfter);
  if (restagedAfterInstall > 0) {
    echo`   📎 Restaged ${restagedAfterInstall} bundled plugin runtime deps from cache`;
    missingAfter = findMissingRuntimeDeps();
  }

  const unresolvedValidationSpecs = validateBundledNodeModules(outputNodeModules)
    .filter((issue) => {
      if (issue.type !== 'missing' && issue.type !== 'version-mismatch') return false;
      const spec = parseDependencySpec(issue.requestedRange);
      if (!isCheckableRange(spec)) return false;
      if (selectCompatibleRealPath(issue.dependencyName, issue.requestedRange)) return false;
      if (resolveExtensionDependencyRealPath(issue.dependencyName, issue.requestedRange)) return false;
      return true;
    })
    .map((issue) => `${issue.dependencyName}@${parseDependencySpec(issue.requestedRange).range}`);

  if (installPackageSpecs(unresolvedValidationSpecs)) {
    const repairedAfterSupplementalInstall = repairBundledDependencyGraph(outputNodeModules);
    if (repairedAfterSupplementalInstall > 0) {
      echo`   🛠️  Repaired ${repairedAfterSupplementalInstall} dependency override(s) after supplemental installs`;
    }
  }

  if (missingAfter.length > 0) {
    throw new Error(
      `Bundled plugin runtime deps are still missing after staging: ${missingAfter.map((dep) => `${dep.name}@${dep.version}`).join(', ')}`
    );
  }
}

await stageBundledPluginRuntimeDeps(OUTPUT);

const repairedAfterPluginStaging = repairBundledDependencyGraph(outputNodeModules);
if (repairedAfterPluginStaging > 0) {
  echo`   🛠️  Repaired ${repairedAfterPluginStaging} dependency override(s) after bundled plugin staging`;
}

// 6. Clean up the bundle to reduce package size
//
// This removes platform-agnostic waste: dev artifacts, docs, source maps,
// type definitions, test directories, and known large unused subdirectories.
// Platform-specific cleanup (e.g. koffi binaries) is handled in after-pack.cjs
// which has access to the target platform/arch context.

function getDirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += getDirSize(p);
      else if (entry.isFile()) total += fs.statSync(p).size;
    }
  } catch { /* ignore */ }
  return total;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
}

function rmSafe(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    else fs.rmSync(target, { force: true });
    return true;
  } catch { return false; }
}

function cleanupBundle(outputDir) {
  let removedCount = 0;
  const nm = path.join(outputDir, 'node_modules');
  const ext = path.join(outputDir, 'extensions');

  function removeNestedBinDirs(rootDir) {
    if (!fs.existsSync(rootDir)) return;

    function walk(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const full = path.join(dir, entry.name);
        if (entry.name === '.bin' && path.basename(dir) === 'node_modules') {
          if (rmSafe(full)) removedCount++;
          continue;
        }
        walk(full);
      }
    }

    walk(rootDir);
  }

  // --- openclaw root junk ---
  for (const name of ['CHANGELOG.md', 'README.md']) {
    if (rmSafe(path.join(outputDir, name))) removedCount++;
  }

  // docs/ is kept — contains prompt templates and other runtime-used prompts

  // --- extensions: clean junk from source, aggressively clean nested node_modules ---
  // Extension source (.ts files) are runtime entry points — must be preserved.
  // Only nested node_modules/ inside extensions get the aggressive cleanup.
  if (fs.existsSync(ext)) {
    const JUNK_EXTS = new Set(['.prose', '.ignored_openclaw', '.keep']);
    const NM_REMOVE_DIRS = new Set([
      'test', 'tests', '__tests__', '.github', 'docs', 'examples', 'example',
    ]);
    const NM_REMOVE_FILE_EXTS = ['.d.ts', '.d.ts.map', '.js.map', '.mjs.map', '.ts.map', '.markdown'];
    const NM_REMOVE_FILE_NAMES = new Set([
      '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
      'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
    ]);

    // .md files inside skills/ directories are runtime content (SKILL.md,
    // block-types.md, etc.) and must NOT be removed.
    const JUNK_MD_NAMES = new Set([
      'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
    ]);

    function walkExt(dir, insideNodeModules, insideSkills) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (insideNodeModules && NM_REMOVE_DIRS.has(entry.name)) {
            if (rmSafe(full)) removedCount++;
          } else {
            walkExt(
              full,
              insideNodeModules || entry.name === 'node_modules',
              insideSkills || entry.name === 'skills',
            );
          }
        } else if (entry.isFile()) {
          if (insideNodeModules) {
            const name = entry.name;
            if (NM_REMOVE_FILE_NAMES.has(name) || NM_REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
              if (rmSafe(full)) removedCount++;
            }
          } else {
            // Inside skills/ directories, .md files are skill content — keep them.
            // Outside skills/, remove known junk .md files only.
            const isMd = entry.name.endsWith('.md');
            const isJunkMd = isMd && JUNK_MD_NAMES.has(entry.name);
            const isJunkExt = JUNK_EXTS.has(path.extname(entry.name));
            if (isJunkExt || (isMd && !insideSkills && isJunkMd)) {
              if (rmSafe(full)) removedCount++;
            }
          }
        }
      }
    }
    walkExt(ext, false, false);
  }

  // Nested node_modules/.bin directories are developer-tool shims. In pnpm
  // installs they can be absolute symlinks into the local workspace cache,
  // which makes packaged macOS bundles fail codesign verification.
  removeNestedBinDirs(ext);

  // --- node_modules: remove unnecessary file types and directories ---
  if (fs.existsSync(nm)) {
    const REMOVE_DIRS = new Set([
      'test', 'tests', '__tests__', '.github', 'docs', 'examples', 'example',
    ]);
    const REMOVE_FILE_EXTS = ['.d.ts', '.d.ts.map', '.js.map', '.mjs.map', '.ts.map', '.markdown'];
    const REMOVE_FILE_NAMES = new Set([
      '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
      'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
    ]);

    function walkClean(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (REMOVE_DIRS.has(entry.name)) {
            if (rmSafe(full)) removedCount++;
          } else {
            walkClean(full);
          }
        } else if (entry.isFile()) {
          const name = entry.name;
          if (REMOVE_FILE_NAMES.has(name) || REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
            if (rmSafe(full)) removedCount++;
          }
        }
      }
    }
    walkClean(nm);
  }

  removeNestedBinDirs(nm);

  // --- known large unused subdirectories ---
  const LARGE_REMOVALS = [
    'node_modules/pdfjs-dist/legacy',
    'node_modules/pdfjs-dist/types',
    'node_modules/node-llama-cpp/llama',
    'node_modules/koffi/src',
    'node_modules/koffi/vendor',
    'node_modules/koffi/doc',
  ];
  for (const rel of LARGE_REMOVALS) {
    if (rmSafe(path.join(outputDir, rel))) removedCount++;
  }

  return removedCount;
}

echo``;
echo`🧹 Cleaning up bundle (removing dev artifacts, docs, source maps, type defs)...`;
const sizeBefore = getDirSize(OUTPUT);
const cleanedCount = cleanupBundle(OUTPUT);
const sizeAfter = getDirSize(OUTPUT);
echo`   Removed ${cleanedCount} files/directories`;
echo`   Size: ${formatSize(sizeBefore)} → ${formatSize(sizeAfter)} (saved ${formatSize(sizeBefore - sizeAfter)})`;

// 7. Patch known broken packages
//
// Some packages in the ecosystem have transpiled CJS output that sets
// `module.exports = exports.default` without ever assigning `exports.default`,
// resulting in `module.exports = undefined`.  This causes a TypeError in
// Node.js 22+ ESM interop when the translators try to call hasOwnProperty on
// the undefined exports object.
//
// We also patch Windows child_process spawn sites in the bundled agent runtime
// so shell/tool execution does not flash a console window for each tool call.
// We patch these files in-place after the copy so the bundle is safe to run.
function patchBrokenModules(nodeModulesDir) {
  const rewritePatches = {
    // node-domexception@1.0.0: transpiled index.js leaves module.exports = undefined.
    // Node.js 18+ ships DOMException as a built-in global, so a simple shim works.
    'node-domexception/index.js': [
      `'use strict';`,
      `// Shim: the original transpiled file sets module.exports = exports.default`,
      `// (which is undefined), causing TypeError in Node.js 22+ ESM interop.`,
      `// Node.js 18+ has DOMException as a built-in global.`,
      `const dom = globalThis.DOMException ||`,
      `  class DOMException extends Error {`,
      `    constructor(msg, name) { super(msg); this.name = name || 'Error'; }`,
      `  };`,
      `module.exports = dom;`,
      `module.exports.DOMException = dom;`,
      `module.exports.default = dom;`,
    ].join('\n'),
  };
  const replacePatches = [
    {
      rel: '@mariozechner/pi-coding-agent/dist/core/bash-executor.js',
      search: `        const child = spawn(shell, [...args, command], {
            detached: true,
            env: getShellEnv(),
            stdio: ["ignore", "pipe", "pipe"],
        });`,
      replace: `        const child = spawn(shell, [...args, command], {
            detached: true,
            env: getShellEnv(),
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });`,
    },
    {
      rel: '@mariozechner/pi-coding-agent/dist/core/exec.js',
      search: `        const proc = spawn(command, args, {
            cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        });`,
      replace: `        const proc = spawn(command, args, {
            cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });`,
    },
  ];

  let count = patchHttpsProxyAgentPackageMetadata(nodeModulesDir);
  count += patchKnownDependencyMetadata(nodeModulesDir);
  for (const [rel, content] of Object.entries(rewritePatches)) {
    const target = path.join(nodeModulesDir, rel);
    if (fs.existsSync(target)) {
      fs.writeFileSync(target, content + '\n', 'utf8');
      count++;
    }
  }
  for (const { rel, search, replace } of replacePatches) {
    const target = path.join(nodeModulesDir, rel);
    if (!fs.existsSync(target)) continue;

    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(search)) {
      echo`   ⚠️  Skipped patch for ${rel}: expected source snippet not found`;
      continue;
    }

    const next = current.replace(search, replace);
    if (next !== current) {
      fs.writeFileSync(target, next, 'utf8');
      count++;
    }
  }
  if (count > 0) {
    echo`   🩹 Patched ${count} broken module(s) in node_modules`;
  }
}

function patchKnownDependencyMetadata(nodeModulesDir) {
  const packageDirs = [];
  const queue = [nodeModulesDir];
  const seen = new Set();

  while (queue.length > 0) {
    const currentNodeModules = queue.shift();
    if (!currentNodeModules || seen.has(currentNodeModules) || !fs.existsSync(currentNodeModules)) continue;
    seen.add(currentNodeModules);

    for (const { fullPath: pkgDir } of listPackages(currentNodeModules)) {
      packageDirs.push(pkgDir);
      const nestedNodeModules = path.join(pkgDir, 'node_modules');
      if (fs.existsSync(nestedNodeModules)) queue.push(nestedNodeModules);
    }
  }

  let count = 0;
  for (const pkgDir of packageDirs) {
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    } catch {
      continue;
    }

    // openclaw@2026.4.2 bundles slack runtime deps with p-queue@6.6.2 but only
    // ships p-timeout@4.x. Runtime works with that tree, but the upstream
    // package.json dependency range is still ^3.2.0, so we normalize the
    // bundled metadata to the actually shipped compatible layout.
    if (
      pkg?.name === 'p-queue' &&
      pkg?.version === '6.6.2' &&
      pkg?.dependencies?.['p-timeout'] === '^3.2.0'
    ) {
      pkg.dependencies['p-timeout'] = '^3.2.0 || ^4.0.0';
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      count++;
    }
  }

  return count;
}

function patchHttpsProxyAgentPackageMetadata(nodeModulesDir) {
  const httpsProxyAgentPkg = path.join(nodeModulesDir, 'https-proxy-agent', 'package.json');
  if (!fs.existsSync(httpsProxyAgentPkg)) return 0;
  try {
    const pkg = JSON.parse(fs.readFileSync(httpsProxyAgentPkg, 'utf8'));
    // Electron run-as-node in packaged builds resolves this package through
    // a CommonJS path. The upstream package only publishes an "import"
    // export, which breaks OpenClaw startup with ERR_PACKAGE_PATH_NOT_EXPORTED.
    pkg.main = './dist/index.js';
    pkg.exports = {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        default: './dist/index.js',
        require: './dist/index.js',
      },
    };
    fs.writeFileSync(httpsProxyAgentPkg, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    return 1;
  } catch (err) {
    echo`   ⚠️  Skipped patch for https-proxy-agent package metadata: ${err.message}`;
    return 0;
  }
}

function findFirstFileByName(rootDir, matcher) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && matcher.test(entry.name)) {
        return fullPath;
      }
    }
  }
  return null;
}

function findFilesByName(rootDir, matcher) {
  const matches = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && matcher.test(entry.name)) {
        matches.push(fullPath);
      }
    }
  }
  return matches;
}

function patchBundledRuntime(outputDir) {
  const replacePatches = [
    {
      label: 'workspace command runner',
      target: () => findFirstFileByName(path.join(outputDir, 'dist'), /^workspace-.*\.js$/),
      search: `\tconst child = spawn(resolvedCommand, finalArgv.slice(1), {
\t\tstdio,
\t\tcwd,
\t\tenv: resolvedEnv,
\t\twindowsVerbatimArguments,
\t\t...shouldSpawnWithShell({
\t\t\tresolvedCommand,
\t\t\tplatform: process$1.platform
\t\t}) ? { shell: true } : {}
\t});`,
      replace: `\tconst child = spawn(resolvedCommand, finalArgv.slice(1), {
\t\tstdio,
\t\tcwd,
\t\tenv: resolvedEnv,
\t\twindowsVerbatimArguments,
\t\twindowsHide: true,
\t\t...shouldSpawnWithShell({
\t\t\tresolvedCommand,
\t\t\tplatform: process$1.platform
\t\t}) ? { shell: true } : {}
\t});`,
    },
    {
      label: 'agent scope command runner',
      target: () => findFirstFileByName(path.join(outputDir, 'dist', 'plugin-sdk'), /^agent-scope-.*\.js$/),
      search: `\tconst child = spawn(resolvedCommand, finalArgv.slice(1), {
\t\tstdio,
\t\tcwd,
\t\tenv: resolvedEnv,
\t\twindowsVerbatimArguments,
\t\t...shouldSpawnWithShell({
\t\t\tresolvedCommand,
\t\t\tplatform: process$1.platform
\t\t}) ? { shell: true } : {}
\t});`,
      replace: `\tconst child = spawn(resolvedCommand, finalArgv.slice(1), {
\t\tstdio,
\t\tcwd,
\t\tenv: resolvedEnv,
\t\twindowsVerbatimArguments,
\t\twindowsHide: true,
\t\t...shouldSpawnWithShell({
\t\t\tresolvedCommand,
\t\t\tplatform: process$1.platform
\t\t}) ? { shell: true } : {}
\t});`,
    },
    {
      label: 'chrome launcher',
      target: () => findFirstFileByName(path.join(outputDir, 'dist', 'plugin-sdk'), /^chrome-.*\.js$/),
      search: `\t\treturn spawn(exe.path, args, {
\t\t\tstdio: "pipe",
\t\t\tenv: {
\t\t\t\t...process.env,
\t\t\t\tHOME: os.homedir()
\t\t\t}
\t\t});`,
      replace: `\t\treturn spawn(exe.path, args, {
\t\t\tstdio: "pipe",
\t\t\twindowsHide: true,
\t\t\tenv: {
\t\t\t\t...process.env,
\t\t\t\tHOME: os.homedir()
\t\t\t}
\t\t});`,
    },
    {
      label: 'qmd runner',
      target: () => findFirstFileByName(path.join(outputDir, 'dist', 'plugin-sdk'), /^qmd-manager-.*\.js$/),
      search: `\t\t\tconst child = spawn(resolveWindowsCommandShim(this.qmd.command), args, {
\t\t\t\tenv: this.env,
\t\t\t\tcwd: this.workspaceDir
\t\t\t});`,
      replace: `\t\t\tconst child = spawn(resolveWindowsCommandShim(this.qmd.command), args, {
\t\t\t\tenv: this.env,
\t\t\t\tcwd: this.workspaceDir,
\t\t\t\twindowsHide: true
\t\t\t});`,
    },
    {
      label: 'mcporter runner',
      target: () => findFirstFileByName(path.join(outputDir, 'dist', 'plugin-sdk'), /^qmd-manager-.*\.js$/),
      search: `\t\t\tconst child = spawn(resolveWindowsCommandShim("mcporter"), args, {
\t\t\t\tenv: this.env,
\t\t\t\tcwd: this.workspaceDir
\t\t\t});`,
      replace: `\t\t\tconst child = spawn(resolveWindowsCommandShim("mcporter"), args, {
\t\t\t\tenv: this.env,
\t\t\t\tcwd: this.workspaceDir,
\t\t\t\twindowsHide: true
\t\t\t});`,
    },
  ];

  let count = 0;
  for (const patch of replacePatches) {
    const target = patch.target();
    if (!target || !fs.existsSync(target)) {
      echo`   ⚠️  Skipped patch for ${patch.label}: target file not found`;
      continue;
    }

    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(patch.search)) {
      echo`   ⚠️  Skipped patch for ${patch.label}: expected source snippet not found`;
      continue;
    }

    const next = current.replace(patch.search, patch.replace);
    if (next !== current) {
      fs.writeFileSync(target, next, 'utf8');
      count++;
    }
  }

  if (count > 0) {
    echo`   🩹 Patched ${count} bundled runtime spawn site(s)`;
  }

  const ptyTargets = findFilesByName(
    path.join(outputDir, 'dist'),
    /^(subagent-registry|reply|pi-embedded)-.*\.js$/,
  );
  const ptyPatches = [
    {
      label: 'pty launcher windowsHide',
      search: `\tconst pty = spawn(params.shell, params.args, {
\t\tcwd: params.cwd,
\t\tenv: params.env ? toStringEnv(params.env) : void 0,
\t\tname: params.name ?? process.env.TERM ?? "xterm-256color",
\t\tcols: params.cols ?? 120,
\t\trows: params.rows ?? 30
\t});`,
      replace: `\tconst pty = spawn(params.shell, params.args, {
\t\tcwd: params.cwd,
\t\tenv: params.env ? toStringEnv(params.env) : void 0,
\t\tname: params.name ?? process.env.TERM ?? "xterm-256color",
\t\tcols: params.cols ?? 120,
\t\trows: params.rows ?? 30,
\t\twindowsHide: true
\t});`,
    },
    {
      label: 'disable pty on windows',
      search: `\t\t\tconst usePty = params.pty === true && !sandbox;`,
      replace: `\t\t\tconst usePty = params.pty === true && !sandbox && process.platform !== "win32";`,
    },
    {
      label: 'disable approval pty on windows',
      search: `\t\t\t\t\tpty: params.pty === true && !sandbox,`,
      replace: `\t\t\t\t\tpty: params.pty === true && !sandbox && process.platform !== "win32",`,
    },
  ];

  let ptyCount = 0;
  for (const patch of ptyPatches) {
    let matchedAny = false;
    for (const target of ptyTargets) {
      const current = fs.readFileSync(target, 'utf8');
      if (!current.includes(patch.search)) continue;
      matchedAny = true;
      const next = current.replaceAll(patch.search, patch.replace);
      if (next !== current) {
        fs.writeFileSync(target, next, 'utf8');
        ptyCount++;
      }
    }
    if (!matchedAny) {
      echo`   ⚠️  Skipped patch for ${patch.label}: expected source snippet not found`;
    }
  }

  if (ptyCount > 0) {
    echo`   🩹 Patched ${ptyCount} bundled PTY site(s)`;
  }
}

patchBrokenModules(outputNodeModules);
patchBundledRuntime(OUTPUT);

// 8. Verify the bundle
const entryExists = fs.existsSync(path.join(OUTPUT, 'openclaw.mjs'));
const distExists = fs.existsSync(path.join(OUTPUT, 'dist', 'entry.js'));

echo``;
echo`✅ Bundle complete: ${OUTPUT}`;
echo`   Unique packages copied: ${copiedCount}`;
echo`   Dev-only packages skipped: ${skippedDevCount}`;
echo`   Duplicate versions skipped: ${skippedDupes}`;
echo`   Nested overrides preserved: ${preservedOverrides}`;
echo`   Total discovered: ${collectedByName.size}`;
echo`   openclaw.mjs: ${entryExists ? '✓' : '✗'}`;
echo`   dist/entry.js: ${distExists ? '✓' : '✗'}`;

if (!entryExists || !distExists) {
  echo`❌ Bundle verification failed!`;
  process.exit(1);
}

let dependencyIssues = validateBundledNodeModules(outputNodeModules);
if (dependencyIssues.length > 0) {
  const repairedBeforeValidationExit = repairBundledDependencyGraph(outputNodeModules);
  if (repairedBeforeValidationExit > 0) {
    echo`   🛠️  Repaired ${repairedBeforeValidationExit} dependency override(s) during final validation`;
    dependencyIssues = validateBundledNodeModules(outputNodeModules);
  }
}

if (dependencyIssues.length > 0) {
  const backfilledFromExtensions = backfillDependencyIssuesFromExtensions(dependencyIssues);
  if (backfilledFromExtensions > 0) {
    echo`   📎 Backfilled ${backfilledFromExtensions} dependency override(s) from built-in extensions during final validation`;
    dependencyIssues = validateBundledNodeModules(outputNodeModules);
  }
}

if (dependencyIssues.length > 0) {
  echo`❌ Bundled dependency validation failed:`;
  for (const line of formatValidationIssues(dependencyIssues)) {
    echo`   - ${line}`;
  }
  process.exit(1);
}

echo`   Dependency validation: ✓`;

fs.writeFileSync(
  BUNDLE_META_PATH,
  JSON.stringify(
    {
      cacheKey: bundleCacheKey,
      generatedAt: new Date().toISOString(),
      openclawReal,
    },
    null,
    2
  ) + '\n',
  'utf8'
);
echo`   Bundle cache metadata: ✓`;
