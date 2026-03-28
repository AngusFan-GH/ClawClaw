import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome } = vi.hoisted(() => ({
  testHome: `/tmp/clawclaw-openclaw-config-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('os', () => {
  const mocked = { homedir: () => testHome };
  return { ...mocked, default: mocked };
});

const configPath = join(testHome, '.openclaw', 'openclaw.json');

async function writeMalformedConfig(raw: string): Promise<void> {
  await mkdir(join(testHome, '.openclaw'), { recursive: true });
  await writeFile(configPath, raw, 'utf8');
}

describe('recoverMalformedOpenClawConfig', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
  });

  it('repairs configs with stray semicolon-only lines while preserving data', async () => {
    await writeMalformedConfig('{\n  "models": {\n    "default": "anthropic"\n  }\n}\n;\n');

    const { recoverMalformedOpenClawConfig } = await import('@electron/utils/openclaw-config');
    const result = await recoverMalformedOpenClawConfig();

    expect(result.outcome).toBe('repaired');
    expect(result.strategy).toBe('normalize');
    expect(result.backupPath).toContain('.repaired-');

    const repaired = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    expect(repaired.models).toEqual({ default: 'anthropic' });
  });

  it('repairs configs when a valid root object is followed by a stray closing brace', async () => {
    await writeMalformedConfig('{\n  "models": {\n    "default": "anthropic"\n  }\n}\n}\n');

    const { recoverMalformedOpenClawConfig } = await import('@electron/utils/openclaw-config');
    const result = await recoverMalformedOpenClawConfig();

    expect(result.outcome).toBe('repaired');
    expect(result.strategy).toBe('trim-root-object');
    expect(result.backupPath).toContain('.repaired-');

    const repaired = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    expect(repaired.models).toEqual({ default: 'anthropic' });
  });

  it('falls back to reset when minimal repair cannot recover the file', async () => {
    await writeMalformedConfig('totally broken ;;;;');

    const { recoverMalformedOpenClawConfig } = await import('@electron/utils/openclaw-config');
    const result = await recoverMalformedOpenClawConfig();

    expect(result.outcome).toBe('reset');
    expect(result.strategy).toBe('reset');
    expect(result.backupPath).toContain('.broken-');

    const repaired = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    expect(repaired).toEqual({});
  });
});
