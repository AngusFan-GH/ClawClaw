import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawclaw-channel-config-${suffix}`,
    testUserData: `/tmp/clawclaw-channel-config-user-data-${suffix}`,
  };
});

vi.mock('os', () => {
  const mocked = { homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('channel config lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('migrates legacy wechat config to the runtime channel id', async () => {
    await writeOpenClawJson({
      channels: {
        wechat: {
          enabled: true,
        },
      },
    });

    const { listConfiguredChannelGroups } = await import('@electron/utils/channel-config');
    const groups = await listConfiguredChannelGroups();

    expect(groups).toEqual([
      {
        type: 'wechat',
        defaultAccountId: 'default',
        configured: true,
        accounts: [
          {
            accountId: 'default',
            isDefaultAccount: true,
            configured: true,
          },
        ],
      },
    ]);

    const config = await readOpenClawJson();
    expect(config.channels).toHaveProperty('wechat');
    expect(config.channels).not.toHaveProperty('openclaw-weixin');
  });

  it('deletes wechat config, allowlist, and runtime state directories together', async () => {
    await writeOpenClawJson({
      channels: {
        'openclaw-weixin': {
          enabled: true,
        },
      },
      plugins: {
        allow: ['openclaw-weixin', 'qqbot'],
      },
    });

    const targets = [
      join(testHome, '.openclaw', 'openclaw-weixin'),
      join(testHome, '.openclaw', 'credentials', 'openclaw-weixin'),
      join(testHome, '.openclaw', 'agents', 'default', 'sessions', '.openclaw-weixin-sync'),
      join(testHome, '.openclaw', 'extensions', 'openclaw-weixin'),
    ];
    for (const target of targets) {
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'marker.txt'), 'x', 'utf8');
    }

    await mkdir(join(testHome, '.openclaw', 'credentials'), { recursive: true });
    await writeFile(
      join(testHome, '.openclaw', 'credentials', 'openclaw-weixin-test-allowFrom.json'),
      '{}',
      'utf8',
    );

    const { deleteChannelConfig, listConfiguredChannels } = await import('@electron/utils/channel-config');
    await deleteChannelConfig('wechat');

    const config = await readOpenClawJson();
    expect(config.channels ?? {}).not.toHaveProperty('openclaw-weixin');
    expect(config.plugins).toEqual({
      allow: ['qqbot'],
    });
    await expect(listConfiguredChannels({ includeCli: false })).resolves.toEqual([]);

    for (const target of targets) {
      await expect(access(target)).rejects.toThrow();
    }
    await expect(
      access(join(testHome, '.openclaw', 'credentials', 'openclaw-weixin-test-allowFrom.json')),
    ).rejects.toThrow();
  });

  it('does not report wechat as configured when only runtime state remains', async () => {
    await writeOpenClawJson({});
    await mkdir(join(testHome, '.openclaw', 'extensions', 'openclaw-weixin'), { recursive: true });

    const { listConfiguredChannels, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');

    await expect(listConfiguredChannels({ includeCli: false })).resolves.toEqual([]);
    await expect(listConfiguredChannelGroups()).resolves.toEqual([]);
  });
});
