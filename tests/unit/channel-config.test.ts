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
    const groups = await listConfiguredChannelGroups({ includeCli: false });

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

  it('treats wechat named accounts with enabled-only config as configured accounts', async () => {
    await writeOpenClawJson({
      channels: {
        'openclaw-weixin': {
          accounts: {
            '3d6aa0bf112f-im-bot': {
              enabled: true,
            },
          },
        },
      },
      plugins: {
        allow: ['openclaw-weixin'],
      },
    });

    const { listConfiguredChannelGroups, listConfiguredChannelAccounts } = await import('@electron/utils/channel-config');

    await expect(listConfiguredChannelAccounts({ includeCli: false })).resolves.toEqual({
      wechat: ['3d6aa0bf112f-im-bot'],
    });
    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([
      {
        type: 'wechat',
        defaultAccountId: '3d6aa0bf112f-im-bot',
        configured: true,
        accounts: [
          {
            accountId: '3d6aa0bf112f-im-bot',
            isDefaultAccount: true,
            configured: true,
          },
        ],
      },
    ]);
  });

  it('collapses shadow default wechat account when a named account already owns the config', async () => {
    await writeOpenClawJson({
      channels: {
        'openclaw-weixin': {
          enabled: true,
          accounts: {
            default: {
              endpoint: 'ws://wechat.example',
              token: 'same-token',
            },
            '3d6aa0bf112f-im-bot': {
              endpoint: 'ws://wechat.example',
              token: 'same-token',
            },
          },
        },
      },
      plugins: {
        allow: ['openclaw-weixin'],
      },
    });

    const { listConfiguredChannelGroups, getChannelConfig } = await import('@electron/utils/channel-config');
    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([
      {
        type: 'wechat',
        defaultAccountId: '3d6aa0bf112f-im-bot',
        configured: true,
        accounts: [
          {
            accountId: '3d6aa0bf112f-im-bot',
            isDefaultAccount: true,
            configured: true,
          },
        ],
      },
    ]);

    await expect(getChannelConfig('wechat', '3d6aa0bf112f-im-bot')).resolves.toEqual({
      endpoint: 'ws://wechat.example',
      token: 'same-token',
    });
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

  it('saves a named wechat account without leaving a shadow default account behind', async () => {
    await writeOpenClawJson({
      channels: {
        'openclaw-weixin': {
          enabled: true,
          endpoint: 'ws://wechat.example',
          token: 'legacy-token',
        },
      },
      plugins: {
        allow: ['openclaw-weixin'],
      },
    });

    const { saveChannelConfig, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');
    await saveChannelConfig('wechat', {
      __accountId: '3d6aa0bf112f-im-bot',
      endpoint: 'ws://wechat.example',
      token: 'legacy-token',
      enabled: true,
    });

    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([
      {
        type: 'wechat',
        defaultAccountId: '3d6aa0bf112f-im-bot',
        configured: true,
        accounts: [
          {
            accountId: '3d6aa0bf112f-im-bot',
            isDefaultAccount: true,
            configured: true,
          },
        ],
      },
    ]);

    const config = await readOpenClawJson();
    expect(config.channels).toEqual({
      'openclaw-weixin': {
        enabled: true,
        accounts: {
          '3d6aa0bf112f-im-bot': {
            endpoint: 'ws://wechat.example',
            token: 'legacy-token',
            enabled: true,
          },
        },
        defaultAccount: '3d6aa0bf112f-im-bot',
      },
    });
  });

  it('does not report wechat as configured when only runtime state remains', async () => {
    await writeOpenClawJson({});
    await mkdir(join(testHome, '.openclaw', 'extensions', 'openclaw-weixin'), { recursive: true });

    const { listConfiguredChannels, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');

    await expect(listConfiguredChannels({ includeCli: false })).resolves.toEqual([]);
    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([]);
  });

  it('deletes wecom config together with the plugin allowlist entry', async () => {
    await writeOpenClawJson({
      channels: {
        wecom: {
          enabled: true,
          botId: 'corp-id',
          secret: 'secret',
        },
      },
      plugins: {
        allow: ['wecom', 'qqbot'],
      },
    });

    const { deleteChannelConfig, listConfiguredChannels, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');
    await deleteChannelConfig('wecom');

    const config = await readOpenClawJson();
    expect(config.channels ?? {}).not.toHaveProperty('wecom');
    expect(config.plugins).toEqual({
      allow: ['qqbot'],
    });
    await expect(listConfiguredChannels({ includeCli: false })).resolves.toEqual([]);
    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([]);
  });

  it('clears invalid defaultAccount when deleting a named channel account', async () => {
    await writeOpenClawJson({
      channels: {
        wecom: {
          enabled: true,
          defaultAccount: 'corp-a',
          accounts: {
            'corp-a': {
              botId: 'corp-a',
              secret: 'secret-a',
            },
            'corp-b': {
              botId: 'corp-b',
              secret: 'secret-b',
            },
          },
        },
      },
      plugins: {
        allow: ['wecom'],
      },
    });

    const { deleteChannelConfig, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');
    await deleteChannelConfig('wecom', 'corp-a');

    const config = await readOpenClawJson();
    expect(config.channels).toEqual({
      wecom: {
        enabled: true,
        accounts: {
          'corp-b': {
            botId: 'corp-b',
            secret: 'secret-b',
          },
        },
      },
    });
    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([
      {
        type: 'wecom',
        defaultAccountId: undefined,
        configured: true,
        accounts: [
          {
            accountId: 'corp-b',
            isDefaultAccount: false,
            configured: true,
          },
        ],
      },
    ]);
  });

  it('cleans dangling wechat plugin allowlist when no configured account remains', async () => {
    await writeOpenClawJson({
      plugins: {
        allow: ['openclaw-weixin', 'qqbot'],
      },
    });
    await mkdir(join(testHome, '.openclaw', 'openclaw-weixin'), { recursive: true });

    const { cleanupDanglingWeChatPluginState } = await import('@electron/utils/channel-config');
    await expect(cleanupDanglingWeChatPluginState()).resolves.toEqual({ cleanedDanglingState: true });

    const config = await readOpenClawJson();
    expect(config.plugins).toEqual({
      allow: ['qqbot'],
    });
    await expect(access(join(testHome, '.openclaw', 'openclaw-weixin'))).rejects.toThrow();
  });

  it('deletes qqbot session state when removing the channel config', async () => {
    await writeOpenClawJson({
      channels: {
        qqbot: {
          enabled: true,
          appId: 'bot-app',
          clientSecret: 'secret',
        },
      },
      plugins: {
        allow: ['qqbot'],
      },
    });

    const sessionDir = join(testHome, '.openclaw', 'qqbot', 'sessions');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'session-default.json'), '{}', 'utf8');

    const { deleteChannelConfig } = await import('@electron/utils/channel-config');
    await deleteChannelConfig('qqbot');

    const config = await readOpenClawJson();
    expect(config.channels ?? {}).not.toHaveProperty('qqbot');
    expect(config.plugins).toBeUndefined();
    await expect(access(sessionDir)).rejects.toThrow();
  });

  it('normalizes feishu plugin allowlist and entries to the canonical plugin id', async () => {
    await writeOpenClawJson({
      channels: {
        feishu: {
          enabled: true,
          appId: 'app-id',
          appSecret: 'app-secret',
        },
      },
      plugins: {
        allow: ['feishu'],
        entries: {
          feishu: { enabled: true },
        },
      },
    });

    const { saveChannelConfig } = await import('@electron/utils/channel-config');
    await saveChannelConfig('feishu', {
      appId: 'app-id',
      appSecret: 'app-secret',
      enabled: true,
    });

    const config = await readOpenClawJson();
    expect(config.plugins).toEqual({
      allow: ['feishu-openclaw-plugin'],
      enabled: true,
      entries: {
        'feishu-openclaw-plugin': { enabled: true },
      },
    });
  });

  it('repairs invalid defaultAccount and shadow default accounts from legacy multi-account data', async () => {
    await writeOpenClawJson({
      channels: {
        'openclaw-weixin': {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: {
              endpoint: 'ws://wechat.example',
              token: 'same-token',
            },
            'bot-a': {
              endpoint: 'ws://wechat.example',
              token: 'same-token',
            },
          },
        },
        wecom: {
          enabled: true,
          defaultAccount: 'missing',
          accounts: {
            corp: {
              botId: 'corp',
              secret: 'secret',
            },
          },
        },
      },
    });

    const { repairChannelConfigConsistency, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');
    await expect(repairChannelConfigConsistency()).resolves.toEqual({ repaired: true });
    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([
      {
        type: 'wechat',
        defaultAccountId: 'bot-a',
        configured: true,
        accounts: [
          {
            accountId: 'bot-a',
            isDefaultAccount: true,
            configured: true,
          },
        ],
      },
      {
        type: 'wecom',
        defaultAccountId: 'corp',
        configured: true,
        accounts: [
          {
            accountId: 'corp',
            isDefaultAccount: true,
            configured: true,
          },
        ],
      },
    ]);
  });

  it('repairs stale channel plugin allowlist entries when no configured channel remains', async () => {
    await writeOpenClawJson({
      plugins: {
        allow: ['openclaw-weixin', 'wecom', 'qqbot'],
      },
    });

    const { repairChannelConfigConsistency } = await import('@electron/utils/channel-config');
    await expect(repairChannelConfigConsistency()).resolves.toEqual({ repaired: true });

    const config = await readOpenClawJson();
    expect(config.plugins).toBeUndefined();
  });
});
