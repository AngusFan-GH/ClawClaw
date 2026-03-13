#!/usr/bin/env node

import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGETS = [
  'release/win-unpacked',
  'release/win-arm64-unpacked',
  'release/win-ia32-unpacked',
];

for (const relativePath of TARGETS) {
  const fullPath = resolve(process.cwd(), relativePath);
  if (!existsSync(fullPath)) continue;
  rmSync(fullPath, { recursive: true, force: true });
  console.log(`[clean-builder-output] removed ${relativePath}`);
}
