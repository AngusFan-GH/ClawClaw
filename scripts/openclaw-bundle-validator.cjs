const { existsSync, readdirSync, readFileSync } = require('fs');
const { join } = require('path');
const semver = require('semver');

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

function collectPackageDirs(nodeModulesRoot) {
  const seen = new Set();
  const result = [];
  const queue = [nodeModulesRoot];

  while (queue.length > 0) {
    const currentNodeModules = queue.shift();
    for (const pkgDir of listPackageEntries(currentNodeModules)) {
      if (seen.has(pkgDir)) continue;
      seen.add(pkgDir);
      result.push(pkgDir);

      const nestedNodeModules = join(pkgDir, 'node_modules');
      if (existsSync(nestedNodeModules)) {
        queue.push(nestedNodeModules);
      }
    }
  }

  return result;
}

function readPackageJson(packageDir) {
  return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
}

function parseDependencySpec(rawRange) {
  const range = String(rawRange || '').trim();
  if (!range) return null;

  if (range.startsWith('npm:')) {
    const spec = range.slice(4);
    const atIndex = spec.lastIndexOf('@');
    if (atIndex <= 0) {
      return {
        type: 'alias',
        aliasTarget: spec,
        range: null,
      };
    }

    return {
      type: 'alias',
      aliasTarget: spec.slice(0, atIndex),
      range: spec.slice(atIndex + 1),
    };
  }

  return {
    type: 'plain',
    aliasTarget: null,
    range,
  };
}

function resolveDependencyPackageJson(pkgDir, nodeModulesRoot, depName) {
  const nested = join(pkgDir, 'node_modules', ...depName.split('/'), 'package.json');
  if (existsSync(nested)) return nested;

  const topLevel = join(nodeModulesRoot, ...depName.split('/'), 'package.json');
  if (existsSync(topLevel)) return topLevel;

  return null;
}

function isCheckableRange(spec) {
  if (!spec?.range) return false;
  if (/^(file:|link:|workspace:|portal:|https?:|git\+|github:)/i.test(spec.range)) return false;
  return Boolean(semver.validRange(spec.range, { loose: true }));
}

function validateBundledNodeModules(nodeModulesRoot) {
  const issues = [];
  const packageDirs = collectPackageDirs(nodeModulesRoot);

  for (const pkgDir of packageDirs) {
    const pkg = readPackageJson(pkgDir);
    const dependencies = pkg.dependencies || {};

    for (const [depName, range] of Object.entries(dependencies)) {
      if (depName.startsWith('@types/')) continue;

      const spec = parseDependencySpec(range);
      if (!spec) continue;

      const resolvedPkgJson = resolveDependencyPackageJson(pkgDir, nodeModulesRoot, depName);
      if (!resolvedPkgJson) {
        issues.push({
          type: 'missing',
          packageName: pkg.name || pkgDir,
          packageVersion: pkg.version || 'unknown',
          packageDir: pkgDir,
          dependencyName: depName,
          requestedRange: String(range),
        });
        continue;
      }

      const resolved = JSON.parse(readFileSync(resolvedPkgJson, 'utf8'));
      const resolvedVersion = resolved.version || 'unknown';
      if (spec.type === 'alias' && spec.aliasTarget && resolved.name !== depName && resolved.name !== spec.aliasTarget) {
        issues.push({
          type: 'alias-mismatch',
          packageName: pkg.name || pkgDir,
          packageVersion: pkg.version || 'unknown',
          packageDir: pkgDir,
          dependencyName: depName,
          requestedRange: String(range),
          resolvedName: resolved.name || 'unknown',
          resolvedVersion,
        });
        continue;
      }

      if (!isCheckableRange(spec)) continue;
      if (semver.satisfies(resolvedVersion, spec.range, { includePrerelease: true, loose: true })) {
        continue;
      }

      issues.push({
        type: 'version-mismatch',
        packageName: pkg.name || pkgDir,
        packageVersion: pkg.version || 'unknown',
        packageDir: pkgDir,
        dependencyName: depName,
        requestedRange: String(range),
        resolvedVersion,
        resolvedPath: resolvedPkgJson,
      });
    }
  }

  return issues;
}

function formatValidationIssues(issues, limit = 20) {
  return issues.slice(0, limit).map((issue) => {
    if (issue.type === 'missing') {
      return `${issue.packageName}@${issue.packageVersion} -> missing ${issue.dependencyName} (${issue.requestedRange})`;
    }

    if (issue.type === 'alias-mismatch') {
      return `${issue.packageName}@${issue.packageVersion} -> ${issue.dependencyName} expected alias target but resolved ${issue.resolvedName}@${issue.resolvedVersion}`;
    }

    return `${issue.packageName}@${issue.packageVersion} -> ${issue.dependencyName} expected ${issue.requestedRange} but resolved ${issue.resolvedVersion}`;
  });
}

module.exports = {
  parseDependencySpec,
  isCheckableRange,
  validateBundledNodeModules,
  formatValidationIssues,
};
