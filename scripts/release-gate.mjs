import { spawnSync } from 'node:child_process';

const checks = [
  {
    label: 'TypeScript typecheck',
    cmd: ['pnpm', 'run', 'typecheck'],
  },
  {
    label: 'ClawCore runtime gate',
    cmd: [
      'pnpm',
      'exec',
      'vitest',
      'run',
      'tests/unit/core-run-service.test.ts',
      'tests/unit/core-run-engine.test.ts',
      'tests/unit/core-conversation-store.test.ts',
    ],
  },
];

for (const check of checks) {
  console.log(`\n[release-gate] ${check.label}`);
  console.log(`[release-gate] $ ${check.cmd.join(' ')}`);

  const result = spawnSync(check.cmd[0], check.cmd.slice(1), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('\n[release-gate] All release checks passed.');
