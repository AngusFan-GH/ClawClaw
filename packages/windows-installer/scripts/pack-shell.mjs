#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(currentDir, '..');
const rootDir = resolve(packageDir, '..', '..');
const rootPackage = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));
const electronBuilderCli = resolve(rootDir, 'node_modules', 'electron-builder', 'cli.js');
const electronVersion = String(rootPackage.devDependencies?.electron ?? rootPackage.dependencies?.electron ?? '')
  .replace(/^[^\d]*/, '');
const archFlags = String(process.env.CLAWCLAW_WIN_ARCHS || 'x64,arm64')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((arch) => `--${arch}`);

const result = spawnSync(process.execPath, [
  electronBuilderCli,
  '--config',
  'electron-builder.yml',
  '--win',
  'portable',
  ...archFlags,
  '--publish',
  'never',
  `-c.extraMetadata.version=${rootPackage.version}`,
  `-c.electronVersion=${electronVersion}`,
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
