#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(currentDir, '..');
const rootDir = resolve(packageDir, '..', '..');
const rootPackage = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));
const electronBuilderBin = resolve(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);

const result = spawnSync(electronBuilderBin, [
  '--config',
  'electron-builder.yml',
  '--win',
  'portable',
  '--publish',
  'never',
  `-c.extraMetadata.version=${rootPackage.version}`,
], {
  cwd: packageDir,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
