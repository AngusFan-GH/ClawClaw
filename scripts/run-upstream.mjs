#!/usr/bin/env node
/** Run pinned DeepSeek Harness workspace operations without shell-specific syntax. */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const operation = process.argv[2]
const commands = {
  version: { args: ['pnpm', '--version'], env: {} },
  install: { args: ['pnpm', 'install', '--frozen-lockfile'], env: { CI: 'true' } },
  build: { args: ['pnpm', 'run', 'build'], env: {} },
  'build-official': {
    args: ['pnpm', 'run', 'build'], env: { CI: 'true', DSH_BUILD_CLIENT_PROFILE: 'official' },
  },
  'pack-dsh': { args: ['pnpm', 'run', 'release:pack', '--family', 'dsh'], env: { CI: 'true' } },
}

const command = commands[operation]
if (command === undefined) {
  throw new Error(`Unknown upstream operation: ${String(operation)}`)
}

execFileSync(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', command.args, {
  cwd: resolve('deepseek-harness'),
  env: { ...process.env, ...command.env },
  stdio: 'inherit',
})
