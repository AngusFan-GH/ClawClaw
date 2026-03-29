import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  validateBundledNodeModules,
} = require('../../scripts/openclaw-bundle-validator.cjs');

function writeJson(filePath: string, value: unknown) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

describe('openclaw bundle validator', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes when a top-level dependency satisfies the requested range', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-bundle-validator-'));
    tempDirs.push(root);
    const nodeModulesRoot = join(root, 'node_modules');

    writeJson(join(nodeModulesRoot, 'minimatch', 'package.json'), {
      name: 'minimatch',
      version: '10.2.4',
      dependencies: {
        'brace-expansion': '^5.0.2',
      },
    });
    writeJson(join(nodeModulesRoot, 'brace-expansion', 'package.json'), {
      name: 'brace-expansion',
      version: '5.0.4',
    });

    expect(validateBundledNodeModules(nodeModulesRoot)).toEqual([]);
  });

  it('fails when an incompatible nested override shadows a valid top-level dependency', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-bundle-validator-'));
    tempDirs.push(root);
    const nodeModulesRoot = join(root, 'node_modules');

    writeJson(join(nodeModulesRoot, 'minimatch', 'package.json'), {
      name: 'minimatch',
      version: '10.2.4',
      dependencies: {
        'brace-expansion': '^5.0.2',
      },
    });
    writeJson(join(nodeModulesRoot, 'brace-expansion', 'package.json'), {
      name: 'brace-expansion',
      version: '5.0.4',
    });
    writeJson(join(nodeModulesRoot, 'minimatch', 'node_modules', 'brace-expansion', 'package.json'), {
      name: 'brace-expansion',
      version: '2.0.2',
    });

    const issues = validateBundledNodeModules(nodeModulesRoot);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      packageName: 'minimatch',
      dependencyName: 'brace-expansion',
      resolvedVersion: '2.0.2',
    });
  });

  it('accepts npm alias dependencies when the alias target version matches', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-bundle-validator-'));
    tempDirs.push(root);
    const nodeModulesRoot = join(root, 'node_modules');

    writeJson(join(nodeModulesRoot, '@isaacs', 'cliui', 'package.json'), {
      name: '@isaacs/cliui',
      version: '8.0.2',
      dependencies: {
        'string-width-cjs': 'npm:string-width@^4.2.0',
      },
    });
    writeJson(join(nodeModulesRoot, 'string-width-cjs', 'package.json'), {
      name: 'string-width',
      version: '4.2.3',
    });

    expect(validateBundledNodeModules(nodeModulesRoot)).toEqual([]);
  });
});
