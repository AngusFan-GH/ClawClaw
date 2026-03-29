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
        allow: ['openclaw-weixin', 'channels'],
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
      allow: ['channels'],
    });
    await expect(listConfiguredChannels({ includeCli: false })).resolves.toEqual([]);

    for (const target of targets) {
      await expect(access(target)).rejects.toThrow();
    }
    await expect(
      access(join(testHome, '.openclaw', 'credentials', 'openclaw-weixin-test-allowFrom.json')),
    ).rejects.toThrow();
  });

  it('does not keep a plugin-only wecom channel visible after deleting its last configured account', async () => {
    await writeOpenClawJson({
      channels: {
        wecom: {
          enabled: true,
          accounts: {
            default: {
              botId: 'wxcorp',
              secret: 'top-secret',
              enabled: true,
            },
          },
          defaultAccount: 'default',
        },
      },
      plugins: {
        entries: {
          wecom: {
            enabled: true,
          },
        },
      },
    });

    const { deleteChannelConfig, listConfiguredChannelAccounts, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');
    await deleteChannelConfig('wecom', 'default');

    await expect(listConfiguredChannelAccounts({ includeCli: false })).resolves.toEqual({});
    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([]);
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
        allow: ['channels'],
      },
    });

    const { deleteChannelConfig, listConfiguredChannels, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');
    await deleteChannelConfig('wecom');

    const config = await readOpenClawJson();
    expect(config.channels ?? {}).not.toHaveProperty('wecom');
    expect(config.plugins).toBeUndefined();
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
        allow: ['channels'],
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

  it('deletes a named default wecom account instead of only clearing top-level fallback fields', async () => {
    await writeOpenClawJson({
      channels: {
        wecom: {
          enabled: true,
          botId: 'legacy-default',
          secret: 'legacy-secret',
          defaultAccount: 'default',
          accounts: {
            default: {
              botId: 'default-bot',
              secret: 'default-secret',
            },
            'corp-b': {
              botId: 'corp-b',
              secret: 'secret-b',
            },
          },
        },
      },
      plugins: {
        allow: ['channels'],
      },
    });

    const { deleteChannelConfig, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');
    await deleteChannelConfig('wecom', 'default');

    const config = await readOpenClawJson();
    expect(config.channels).toEqual({
      wecom: {
        enabled: true,
        botId: 'legacy-default',
        secret: 'legacy-secret',
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

  it('does not synthesize a duplicate default account row from top-level wecom fields when named accounts exist', async () => {
    await writeOpenClawJson({
      channels: {
        wecom: {
          enabled: true,
          botId: 'legacy-default',
          secret: 'legacy-secret',
          accounts: {
            'corp-b': {
              botId: 'corp-b',
              secret: 'secret-b',
            },
          },
        },
      },
      plugins: {
        allow: ['channels'],
      },
    });

    const { listConfiguredChannelAccounts, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');

    await expect(listConfiguredChannelAccounts({ includeCli: false })).resolves.toEqual({
      wecom: ['corp-b'],
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
        allow: ['openclaw-weixin', 'channels'],
        entries: {
          'openclaw-weixin': {
            enabled: true,
          },
        },
        installs: {
          'openclaw-weixin': {
            installPath: join(testHome, '.openclaw', 'extensions', 'openclaw-weixin'),
          },
        },
      },
      channels: {
        'openclaw-weixin': {
          enabled: false,
          accounts: {
            stale: {
              enabled: false,
            },
          },
        },
      },
    });
    await mkdir(join(testHome, '.openclaw', 'openclaw-weixin'), { recursive: true });
    await mkdir(join(testHome, '.openclaw', 'extensions', 'openclaw-weixin'), { recursive: true });

    const { cleanupDanglingWeChatPluginState } = await import('@electron/utils/channel-config');
    await expect(cleanupDanglingWeChatPluginState()).resolves.toEqual({ cleanedDanglingState: true });

    const config = await readOpenClawJson();
    expect(config.plugins).toEqual({
      allow: ['channels'],
    });
    await expect(access(join(testHome, '.openclaw', 'openclaw-weixin'))).rejects.toThrow();
    await expect(access(join(testHome, '.openclaw', 'extensions', 'openclaw-weixin'))).rejects.toThrow();
    expect(config.channels).toBeUndefined();
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
        allow: ['channels'],
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
      allow: ['feishu'],
      enabled: true,
      entries: {
        feishu: { enabled: true },
      },
    });
  });

  it('preserves existing feishu accounts when adding a second named account', async () => {
    const { saveChannelConfig, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');

    await saveChannelConfig('feishu', {
      __accountId: 'team-a',
      appId: 'app-a',
      appSecret: 'secret-a',
      enabled: true,
    });

    await saveChannelConfig('feishu', {
      __accountId: 'team-b',
      appId: 'app-b',
      appSecret: 'secret-b',
      enabled: true,
    });

    const config = await readOpenClawJson();
    expect(config.channels).toEqual({
      feishu: {
        enabled: true,
        defaultAccount: 'team-a',
        accounts: {
          'team-a': {
            appId: 'app-a',
            appSecret: 'secret-a',
            enabled: true,
            dmPolicy: 'open',
            allowFrom: ['*'],
          },
          'team-b': {
            appId: 'app-b',
            appSecret: 'secret-b',
            enabled: true,
            dmPolicy: 'open',
            allowFrom: ['*'],
          },
        },
      },
    });

    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([
      {
        type: 'feishu',
        defaultAccountId: 'team-a',
        configured: true,
        accounts: [
          {
            accountId: 'team-a',
            isDefaultAccount: true,
            configured: true,
          },
          {
            accountId: 'team-b',
            isDefaultAccount: false,
            configured: true,
          },
        ],
      },
    ]);
  });

  it('preserves a legacy top-level feishu account when adding a new named account', async () => {
    await writeOpenClawJson({
      channels: {
        feishu: {
          enabled: true,
          appId: 'legacy-app',
          appSecret: 'legacy-secret',
          dmPolicy: 'open',
          allowFrom: ['*'],
        },
      },
      plugins: {
        allow: ['feishu'],
        entries: {
          feishu: { enabled: true },
        },
      },
    });

    const { saveChannelConfig, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');
    await saveChannelConfig('feishu', {
      __accountId: 'team-b',
      appId: 'app-b',
      appSecret: 'secret-b',
      enabled: true,
    });

    const config = await readOpenClawJson();
    expect(config.channels).toEqual({
      feishu: {
        enabled: true,
        defaultAccount: 'default',
        accounts: {
          default: {
            appId: 'legacy-app',
            appSecret: 'legacy-secret',
            dmPolicy: 'open',
            allowFrom: ['*'],
            enabled: true,
          },
          'team-b': {
            appId: 'app-b',
            appSecret: 'secret-b',
            enabled: true,
            dmPolicy: 'open',
            allowFrom: ['*'],
          },
        },
      },
    });

    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([
      {
        type: 'feishu',
        defaultAccountId: 'default',
        configured: true,
        accounts: [
          {
            accountId: 'default',
            isDefaultAccount: true,
            configured: true,
          },
          {
            accountId: 'team-b',
            isDefaultAccount: false,
            configured: true,
          },
        ],
      },
    ]);
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

  it('deletes only the selected feishu account and preserves remaining accounts plus plugin state', async () => {
    const { saveChannelConfig, deleteChannelConfig, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');

    await saveChannelConfig('feishu', {
      __accountId: 'team-a',
      appId: 'app-a',
      appSecret: 'secret-a',
      enabled: true,
    });
    await saveChannelConfig('feishu', {
      __accountId: 'team-b',
      appId: 'app-b',
      appSecret: 'secret-b',
      enabled: true,
    });

    await deleteChannelConfig('feishu', 'team-b');

    const config = await readOpenClawJson();
    expect(config.channels).toEqual({
      feishu: {
        enabled: true,
        defaultAccount: 'team-a',
        accounts: {
          'team-a': {
            appId: 'app-a',
            appSecret: 'secret-a',
            enabled: true,
            dmPolicy: 'open',
            allowFrom: ['*'],
          },
        },
      },
    });
    expect(config.plugins).toEqual({
      allow: ['feishu'],
      enabled: true,
      entries: {
        feishu: { enabled: true },
      },
    });

    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([
      {
        type: 'feishu',
        defaultAccountId: 'team-a',
        configured: true,
        accounts: [
          {
            accountId: 'team-a',
            isDefaultAccount: true,
            configured: true,
          },
        ],
      },
    ]);
  });

  it('does not keep a plugin-only feishu channel visible after deleting its last configured account', async () => {
    const { saveChannelConfig, deleteChannelConfig, listConfiguredChannelAccounts, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');

    await saveChannelConfig('feishu', {
      __accountId: 'team-a',
      appId: 'app-a',
      appSecret: 'secret-a',
      enabled: true,
    });

    await deleteChannelConfig('feishu', 'team-a');

    await expect(listConfiguredChannelAccounts({ includeCli: false })).resolves.toEqual({});
    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([]);
  });

  it('does not keep a plugin-only qqbot channel visible after deleting its last configured account', async () => {
    await writeOpenClawJson({
      channels: {
        qqbot: {
          enabled: true,
          accounts: {
            default: {
              appId: 'qq-app',
              token: 'qq-token',
              secret: 'qq-secret',
              enabled: true,
            },
          },
          defaultAccount: 'default',
        },
      },
      plugins: {
        entries: {
          qqbot: {
            enabled: true,
          },
        },
      },
    });

    const { deleteChannelConfig, listConfiguredChannelAccounts, listConfiguredChannelGroups } = await import('@electron/utils/channel-config');
    await deleteChannelConfig('qqbot', 'default');

    await expect(listConfiguredChannelAccounts({ includeCli: false })).resolves.toEqual({});
    await expect(listConfiguredChannelGroups({ includeCli: false })).resolves.toEqual([]);
  });

  it('repairs stale channel plugin allowlist entries when no configured channel remains', async () => {
    await writeOpenClawJson({
      plugins: {
        allow: ['openclaw-weixin', 'channels', 'wecom', 'qqbot'],
      },
    });

    const { repairChannelConfigConsistency } = await import('@electron/utils/channel-config');
    await expect(repairChannelConfigConsistency()).resolves.toEqual({ repaired: true });

    const config = await readOpenClawJson();
    expect(config.plugins).toBeUndefined();
  });

  it('re-enables the wechat managed plugin entry when wechat channel config exists', async () => {
    await writeOpenClawJson({
      channels: {
        'openclaw-weixin': {
          enabled: true,
          appId: 'wx-app',
        },
      },
      plugins: {
        enabled: true,
      },
    });

    const { repairChannelConfigConsistency } = await import('@electron/utils/channel-config');
    await expect(repairChannelConfigConsistency()).resolves.toEqual({ repaired: true });

    const config = await readOpenClawJson();
    expect(config.plugins?.allow).toContain('openclaw-weixin');
    expect(config.plugins?.entries?.['openclaw-weixin']).toMatchObject({ enabled: true });
  });

  it('removes managed channel plugins whose manifest is missing configSchema', async () => {
    const channelsDir = join(testHome, '.openclaw', 'extensions', 'channels');
    const wechatDir = join(testHome, '.openclaw', 'extensions', 'openclaw-weixin');
    await mkdir(channelsDir, { recursive: true });
    await mkdir(wechatDir, { recursive: true });
    await writeFile(
      join(channelsDir, 'openclaw.plugin.json'),
      JSON.stringify({ id: 'channels', name: 'China Channels' }, null, 2),
      'utf8',
    );
    await writeFile(
      join(wechatDir, 'openclaw.plugin.json'),
      JSON.stringify({ id: 'openclaw-weixin', name: 'WeChat', configSchema: { type: 'object' } }, null, 2),
      'utf8',
    );

    const { cleanupInvalidManagedChannelPlugins } = await import('@electron/utils/channel-config');
    await expect(cleanupInvalidManagedChannelPlugins()).resolves.toEqual({
      cleaned: true,
      removedPluginIds: ['channels'],
    });

    await expect(access(channelsDir)).rejects.toThrow();
    await expect(access(wechatDir)).resolves.toBeUndefined();
  });

  it('removes managed channel plugins whose root plugin-sdk imports are incompatible with current runtime', async () => {
    const wechatDir = join(testHome, '.openclaw', 'extensions', 'openclaw-weixin');
    await mkdir(join(wechatDir, 'src'), { recursive: true });
    await writeFile(
      join(wechatDir, 'openclaw.plugin.json'),
      JSON.stringify({
        id: 'openclaw-weixin',
        name: 'WeChat',
        configSchema: { type: 'object' },
      }, null, 2),
      'utf8',
    );
    await writeFile(
      join(wechatDir, 'src', 'channel.ts'),
      'import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk";\nexport const temp = resolvePreferredOpenClawTmpDir();\n',
      'utf8',
    );

    const { cleanupInvalidManagedChannelPlugins } = await import('@electron/utils/channel-config');
    await expect(cleanupInvalidManagedChannelPlugins()).resolves.toEqual({
      cleaned: true,
      removedPluginIds: ['openclaw-weixin'],
    });

    await expect(access(wechatDir)).rejects.toThrow();
  });
});
