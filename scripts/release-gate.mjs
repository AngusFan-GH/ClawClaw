#!/usr/bin/env node
/**
 * Release gate — runs, in strict order, and fails on the first error:
 *   1. typecheck (renderer + backend)
 *   2. full Vitest suite
 *   3. Vite renderer build
 *   4. ClawCore backend bundle
 *   5. standalone backend smoke (temporary data dir, fake keychain)
 *   6. Rust/Tauri `cargo check`
 *
 * Uses the locally installed binaries (no global pnpm/toolchain dependency).
 */
import { spawnSync } from 'node:child_process';

const run = (command, args = []) =>
  spawnSync(command, args, { stdio: 'inherit', env: process.env });

const steps = [
  ['typecheck renderer', [process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit']],
  ['typecheck backend', [process.execPath, 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.node.json', '--noEmit']],
  ['vitest', [process.execPath, 'node_modules/vitest/vitest.mjs', 'run']],
  ['vite build', [process.execPath, 'node_modules/vite/bin/vite.js', 'build']],
  ['backend build', [process.execPath, 'scripts/build-backend.mjs']],
  ['backend smoke', [process.execPath, 'scripts/smoke-backend.mjs']],
  ['cargo check', ['cargo', 'check', '--manifest-path', 'src-tauri/Cargo.toml']],
];

for (const [label, [command, ...args]] of steps) {
  console.log(`\n=== release gate: ${label} ===`);
  const result = run(command, args);
  if (result.status !== 0) {
    console.error(`\nrelease gate FAILED at: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nrelease gate OK');
