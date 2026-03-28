import { spawnSync } from 'node:child_process';

const checks = [
  {
    label: 'TypeScript typecheck',
    cmd: ['pnpm', 'run', 'typecheck'],
  },
  {
    label: 'Upgrade compatibility gate',
    cmd: [
      'pnpm',
      'exec',
      'vitest',
      'run',
      'tests/unit/upgrade-compatibility.test.ts',
      'tests/unit/openclaw-config.test.ts',
      'tests/unit/gateway-startup-recovery.test.ts',
      'tests/unit/gateway-recovery.test.ts',
      'tests/unit/bundled-plugin-installer.test.ts',
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
