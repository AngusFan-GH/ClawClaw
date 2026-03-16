#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';
import { platform } from 'node:os';

const hasCommand = (name) => {
  const command = platform() === 'win32' ? `where.exe ${name}` : `command -v ${name}`;

  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const hasNsis = hasCommand('makensis');
const target = hasNsis ? 'nsis' : 'portable';
const args = process.argv.slice(2);

if (hasNsis) {
  console.log('[package:win] Found NSIS (makensis), building NSIS installer.');
} else {
  console.log('[package:win] NSIS not found, fallback to portable build.');
}

const result = spawnSync('electron-builder', ['--win', target, ...args], {
  stdio: 'inherit',
  shell: true,
});

if (result.error) {
  console.error('[package:win] Failed to start electron-builder:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
