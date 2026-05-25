const fs = require('fs');
const path = require('path');
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

function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
}

function createLogger(logger) {
  return {
    info: logger?.info || (() => {}),
    warn: logger?.warn || (() => {}),
  };
}

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
  let changedFiles = 0;

  for (const filePath of collectPluginSourceFiles(rootDir)) {
    const source = fs.readFileSync(normWin(filePath), 'utf8');
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
    fs.writeFileSync(normWin(filePath), nextContent, 'utf8');
    changedFiles++;
  }

  return changedFiles;
}

// Known plugin-sdk subpaths from which it is legitimate to import
// `resolvePreferredOpenClawTmpDir` in the openclaw@2026.5.12 era. Importing
// it from the bare `openclaw/plugin-sdk` or from `openclaw/plugin-sdk/compat`
// is the broken pattern this validator is guarding against.
const TMPDIR_RESOLVE_OK_SUBPATHS = ['infra-runtime', 'temp-path'];

function hasIncompatiblePluginSdkImports(rootDir) {
  for (const filePath of collectPluginSourceFiles(rootDir)) {
    const source = fs.readFileSync(normWin(filePath), 'utf8');
    if (/openclaw\/plugin-sdk\/compat/.test(source)) {
      return true;
    }
    if (
      /resolvePreferredOpenClawTmpDir/.test(source)
      && /openclaw\/plugin-sdk/.test(source)
      && !TMPDIR_RESOLVE_OK_SUBPATHS.some((sub) =>
        new RegExp(`openclaw\\/plugin-sdk\\/${sub}`).test(source),
      )
    ) {
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

function bundlePluginMirror({
  nodeModulesRoot,
  npmName,
  destDir,
  pluginLabel = npmName,
  logger,
  missingPackageMode = 'throw',
  requireManifest = true,
}) {
  const log = createLogger(logger);
  const pkgPath = path.join(nodeModulesRoot, ...npmName.split('/'));
  if (!fs.existsSync(pkgPath)) {
    const message = `Plugin package not found: ${pkgPath}. Run pnpm install.`;
    if (missingPackageMode === 'warn-return-false') {
      log.warn(message);
      return false;
    }
    throw new Error(message);
  }

  let realPluginPath;
  try {
    realPluginPath = fs.realpathSync.native(pkgPath);
  } catch {
    realPluginPath = pkgPath;
  }

  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  fs.cpSync(normWin(realPluginPath), normWin(destDir), { recursive: true, dereference: true });
  const copiedRootNodeModules = path.join(destDir, 'node_modules');
  if (fs.existsSync(normWin(copiedRootNodeModules))) {
    fs.rmSync(normWin(copiedRootNodeModules), { recursive: true, force: true });
  }

  const repairedSourceFiles = repairPluginSdkRootImports(destDir);
  if (repairedSourceFiles > 0) {
    log.info(`Repaired ${repairedSourceFiles} plugin-sdk import file(s) for ${pluginLabel}`);
  }
  if (hasIncompatiblePluginSdkImports(destDir)) {
    throw new Error(`Bundled plugin ${pluginLabel} still contains incompatible plugin-sdk imports after repair.`);
  }

  const collectedByName = new Map();
  const discoveredRealPathsByName = new Map();
  const visitedRealPaths = new Set();
  const queue = [];
  const rootVirtualNM = getVirtualStoreNodeModules(realPluginPath);
  if (!rootVirtualNM) {
    const message = `Could not find virtual store for ${npmName}`;
    if (missingPackageMode === 'warn-return-false') {
      log.warn(`${message}, skipping deps.`);
      return true;
    }
    throw new Error(message);
  }
  queue.push({ nodeModulesDir: rootVirtualNM, skipPkg: npmName });

  const skipPackages = new Set(['typescript', '@playwright/test']);
  const skipScopes = ['@types/'];
  try {
    const pluginPkg = JSON.parse(fs.readFileSync(path.join(destDir, 'package.json'), 'utf8'));
    for (const peer of Object.keys(pluginPkg.peerDependencies || {})) {
      skipPackages.add(peer);
    }
  } catch {
    // ignore
  }

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
    const spec = parseDependencySpec(rawRange);
    const check = (pkg) => {
      if (!pkg) return false;
      if (spec.type === 'alias' && spec.aliasTarget && pkg.name !== pkgName && pkg.name !== spec.aliasTarget) {
        return false;
      }
      if (!isCheckableRange(spec)) return true;
      return semver.satisfies(pkg.version || '0.0.0', spec.range, { includePrerelease: true, loose: true });
    };

    for (const realPath of (discoveredRealPathsByName.get(pkgName) || [])) {
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(realPath, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      if (check(pkg)) return realPath;
    }

    const bundlePkgPaths = [];
    const scanStack = [path.join(destDir, 'node_modules')];
    while (scanStack.length > 0) {
      const dir = scanStack.shift();
      let entries = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry === '.bin' || entry === pkgName) continue;
        const full = path.join(dir, entry);
        const nestedNM = path.join(full, 'node_modules');
        if (fs.existsSync(nestedNM)) {
          scanStack.push(nestedNM);
        }
      }
      const pkgInDir = path.join(dir, pkgName);
      if (fs.existsSync(pkgInDir)) {
        bundlePkgPaths.push(pkgInDir);
      }
    }

    for (const realPath of bundlePkgPaths) {
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(realPath, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      if (check(pkg)) return realPath;
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
          log.warn(`Failed to repair ${issue.packageName} -> ${issue.dependencyName}: ${err.message}`);
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
      if (skipPackages.has(name) || skipScopes.some((scope) => name.startsWith(scope))) continue;

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

  const outputNodeModules = path.join(destDir, 'node_modules');
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
      log.warn(`Skipped ${pkgName}: ${err.message}`);
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
      if (skipPackages.has(depName) || skipScopes.some((scope) => depName.startsWith(scope))) continue;

      let depRealPath;
      try {
        depRealPath = fs.realpathSync.native(fullPath);
      } catch {
        continue;
      }

      const topLevelRealPath = copiedRealPathsByName.get(depName);
      if (!topLevelRealPath || topLevelRealPath === depRealPath) continue;

      const pkgJson = (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(pkgRealPath, 'package.json'), 'utf8'));
        } catch {
          return null;
        }
      })();
      if (pkgJson) {
        const depRange = (pkgJson.dependencies || {})[depName];
        if (depRange) {
          const depSpec = parseDependencySpec(depRange);
          if (depSpec && isCheckableRange(depSpec)) {
            const topPkgJson = (() => {
              try {
                return JSON.parse(fs.readFileSync(path.join(topLevelRealPath, 'package.json'), 'utf8'));
              } catch {
                return null;
              }
            })();
            if (topPkgJson && semver.satisfies(topPkgJson.version || '0.0.0', depSpec.range, { includePrerelease: true, loose: true })) {
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
        log.warn(`Failed nested override ${pkgName} -> ${depName}: ${err.message}`);
      }
    }
  }

  const repairedDependencyIssues = repairBundledDependencyGraph(outputNodeModules);
  if (repairedDependencyIssues > 0) {
    log.info(`${pluginLabel}: repaired ${repairedDependencyIssues} bundled dependency override(s)`);
  }

  if (requireManifest) {
    const manifestPath = path.join(destDir, 'openclaw.plugin.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Missing openclaw.plugin.json in bundled plugin output: ${pluginLabel}`);
    }
  }

  const dependencyIssues = validateBundledNodeModules(outputNodeModules);
  if (dependencyIssues.length > 0) {
    throw new Error(
      `Bundled plugin dependency validation failed for ${pluginLabel}:\n${formatValidationIssues(dependencyIssues).join('\n')}`
    );
  }

  return {
    copiedCount,
    skippedDupes,
    preservedOverrides,
    repairedSourceFiles,
    repairedDependencyIssues,
  };
}

module.exports = {
  bundlePluginMirror,
};
