import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawclaw-upgrade-compat-${suffix}`,
    testUserData: `/tmp/clawclaw-upgrade-compat-user-data-${suffix}`,
  };
});

const storeState = vi.hoisted(() => ({
  stores: new Map<string, Record<string, unknown>>(),
}));

vi.mock('os', () => {
  const mocked = { homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('node:os', () => {
  const mocked = { homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
    getAppPath: () => process.cwd(),
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    private readonly name: string;
    private readonly defaults: T;

    constructor(options?: { name?: string; defaults?: T }) {
      this.name = options?.name || 'default';
      this.defaults = structuredClone((options?.defaults || {}) as T);
      if (!storeState.stores.has(this.name)) {
        storeState.stores.set(this.name, structuredClone(this.defaults) as Record<string, unknown>);
      }
    }

    get(key?: string): unknown {
      const data = storeState.stores.get(this.name) || {};
      if (!key) return data;
      return data[key];
    }

    set(key: string, value: unknown): void {
      const data = storeState.stores.get(this.name) || {};
      data[key] = value;
      storeState.stores.set(this.name, data);
    }

    delete(key: string): void {
      const data = storeState.stores.get(this.name) || {};
      delete data[key];
      storeState.stores.set(this.name, data);
    }
  }

  return {
    default: MockStore,
  };
});

vi.mock('@electron/utils/openclaw-runtime-integrity', () => ({
  validateBundledOpenClawRuntime: vi.fn(async () => undefined),
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function writeRawOpenClawJson(raw: string): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), raw, 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

async function readAuthProfiles(agentId = 'main'): Promise<Record<string, unknown>> {
  const content = await readFile(
    join(testHome, '.openclaw', 'agents', agentId, 'agent', 'auth-profiles.json'),
    'utf8',
  );
  return JSON.parse(content) as Record<string, unknown>;
}

async function writePlugin(
  dir: string,
  pluginId: string,
  version: string,
  options?: { withNodeModules?: boolean },
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'openclaw.plugin.json'),
    JSON.stringify({ id: pluginId, name: pluginId, configSchema: { type: 'object' } }, null, 2),
    'utf8',
  );
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: pluginId, version }, null, 2), 'utf8');
  await writeFile(join(dir, 'index.js'), 'module.exports = {};', 'utf8');
  if (options?.withNodeModules) {
    await mkdir(join(dir, 'node_modules', 'dep'), { recursive: true });
    await writeFile(
      join(dir, 'node_modules', 'dep', 'package.json'),
      JSON.stringify({ name: 'dep', version: '1.0.0' }, null, 2),
      'utf8',
    );
  }
}

async function cleanupDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

async function flushBackgroundWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

describe('upgrade compatibility baseline', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    storeState.stores.clear();
    await cleanupDir(testHome);
    await cleanupDir(testUserData);
    await cleanupDir(join(process.cwd(), 'build', 'openclaw-plugins', 'test-upgrade-plugin'));
    await cleanupDir(join(process.cwd(), 'build', 'openclaw-plugins', 'channels'));
  });

  afterEach(async () => {
    await flushBackgroundWork();
    await cleanupDir(join(process.cwd(), 'build', 'openclaw-plugins', 'test-upgrade-plugin'));
    await cleanupDir(join(process.cwd(), 'build', 'openclaw-plugins', 'channels'));
    await cleanupDir(testHome);
    await cleanupDir(testUserData);
  });

  it('migrates a legacy provider store into account-based records and preserves the default provider', async () => {
    const legacyCreatedAt = '2026-03-01T00:00:00.000Z';
    const legacyUpdatedAt = '2026-03-02T00:00:00.000Z';
    storeState.stores.set('clawclaw-providers', {
      schemaVersion: 0,
      providers: {
        moonshot: {
          id: 'moonshot',
          name: 'Moonshot',
          type: 'moonshot',
          model: 'kimi-k2.5',
          enabled: true,
          createdAt: legacyCreatedAt,
          updatedAt: legacyUpdatedAt,
        },
      },
      providerAccounts: {},
      apiKeys: {},
      providerSecrets: {},
      defaultProvider: 'moonshot',
      defaultProviderAccountId: null,
    });

    const { ensureProviderStoreMigrated } = await import('@electron/services/providers/provider-migration');
    const { getClawXProviderStore } = await import('@electron/services/providers/store-instance');

    await ensureProviderStoreMigrated();

    const store = await getClawXProviderStore();
    const providerAccounts = store.get('providerAccounts') as Record<string, Record<string, unknown>>;
    expect(store.get('schemaVersion')).toBe(1);
    expect(store.get('defaultProviderAccountId')).toBe('moonshot');
    expect(providerAccounts.moonshot).toMatchObject({
      id: 'moonshot',
      vendorId: 'moonshot',
      label: 'Moonshot',
      model: 'kimi-k2.5',
      enabled: true,
      isDefault: true,
      createdAt: legacyCreatedAt,
      updatedAt: legacyUpdatedAt,
    });
  });

  it('reconciles stale runtime config to the current default provider before gateway launch', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'anthropic/claude-old',
            fallbacks: [],
          },
        },
      },
      models: {
        providers: {
          anthropic: {
            baseUrl: 'https://api.anthropic.com/v1',
            api: 'anthropic-messages',
          },
        },
      },
    });

    storeState.stores.set('clawclaw-providers', {
      schemaVersion: 1,
      providers: {},
      providerAccounts: {
        openrouter: {
          id: 'openrouter',
          vendorId: 'openrouter',
          label: 'OpenRouter',
          authMode: 'api_key',
          model: 'openai/gpt-4.1-mini',
          enabled: true,
          isDefault: true,
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-02T00:00:00.000Z',
        },
      },
      apiKeys: {
        openrouter: 'sk-test-openrouter',
      },
      providerSecrets: {
        openrouter: {
          type: 'api_key',
          accountId: 'openrouter',
          apiKey: 'sk-test-openrouter',
        },
      },
      defaultProvider: 'openrouter',
      defaultProviderAccountId: 'openrouter',
    });

    const { syncGatewayConfigBeforeLaunch } = await import('@electron/gateway/config-sync');

    await syncGatewayConfigBeforeLaunch({
      theme: 'system',
      language: 'zh',
      startMinimized: false,
      launchAtStartup: false,
      gatewayAutoStart: true,
      gatewayPort: 18789,
      gatewayToken: 'test-token',
      proxyMode: 'system',
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
      updateChannel: 'stable',
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      skippedVersions: [],
      sidebarCollapsed: false,
      devModeUnlocked: false,
      setupComplete: false,
      selectedBundles: [],
      enabledSkills: [],
      disabledSkills: [],
      securityPolicy: {
        enabled: false,
        deniedPaths: [],
        permissions: {
          denyRuntime: false,
          denyWrite: false,
          denyRead: false,
          denyBrowser: false,
          denyWebSearch: false,
          denyWebFetch: false,
          denyGateway: false,
        },
      },
      reminders: [],
      sessionMemoryEnabled: true,
      memorySearchEnabled: true,
    });
    await flushBackgroundWork();

    const config = await readOpenClawJson();
    expect((config.agents as { defaults: { model: { primary: string } } }).defaults.model.primary)
      .toBe('openrouter/openai/gpt-4.1-mini');

    const authProfiles = await readAuthProfiles('main');
    expect(
      (authProfiles.profiles as Record<string, { key: string }>)['openrouter:default'].key,
    ).toBe('sk-test-openrouter');
  });

  it('recovers a malformed legacy runtime config during upgrade and preserves a backup', async () => {
    await writeRawOpenClawJson('{\n  "models": {\n    "default": "anthropic"\n  }\n}\n;\n');

    const { recoverMalformedOpenClawConfig } = await import('@electron/utils/openclaw-config');
    const result = await recoverMalformedOpenClawConfig();

    expect(result.outcome).toBe('repaired');
    expect(result.backupPath).toContain('.repaired-');

    const config = await readOpenClawJson();
    expect(config.models).toEqual({ default: 'anthropic' });

    const backups = await readdir(join(testHome, '.openclaw'));
    expect(backups.some((entry) => entry.includes('openclaw.json.repaired-') && entry.endsWith('.bak'))).toBe(true);
  });

  it('repairs malformed config before startup sync and still converges runtime provider/auth state', async () => {
    await writeRawOpenClawJson('{\n  "agents": {\n    "defaults": {\n      "model": {\n        "primary": "anthropic/claude-old",\n        "fallbacks": []\n      }\n    }\n  }\n}\n}\n');

    storeState.stores.set('clawclaw-providers', {
      schemaVersion: 1,
      providers: {},
      providerAccounts: {
        openrouter: {
          id: 'openrouter',
          vendorId: 'openrouter',
          label: 'OpenRouter',
          authMode: 'api_key',
          model: 'openai/gpt-4.1-mini',
          enabled: true,
          isDefault: true,
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-02T00:00:00.000Z',
        },
      },
      apiKeys: {
        openrouter: 'sk-test-openrouter',
      },
      providerSecrets: {
        openrouter: {
          type: 'api_key',
          accountId: 'openrouter',
          apiKey: 'sk-test-openrouter',
        },
      },
      defaultProvider: 'openrouter',
      defaultProviderAccountId: 'openrouter',
    });

    const { syncGatewayConfigBeforeLaunch } = await import('@electron/gateway/config-sync');

    await syncGatewayConfigBeforeLaunch({
      theme: 'system',
      language: 'zh',
      startMinimized: false,
      launchAtStartup: false,
      gatewayAutoStart: true,
      gatewayPort: 18789,
      gatewayToken: 'test-token',
      proxyMode: 'system',
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
      updateChannel: 'stable',
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      skippedVersions: [],
      sidebarCollapsed: false,
      devModeUnlocked: false,
      setupComplete: false,
      selectedBundles: [],
      enabledSkills: [],
      disabledSkills: [],
      securityPolicy: {
        enabled: false,
        deniedPaths: [],
        permissions: {
          denyRuntime: false,
          denyWrite: false,
          denyRead: false,
          denyBrowser: false,
          denyWebSearch: false,
          denyWebFetch: false,
          denyGateway: false,
        },
      },
      reminders: [],
      sessionMemoryEnabled: true,
      memorySearchEnabled: true,
    });
    await flushBackgroundWork();

    const config = await readOpenClawJson();
    expect((config.agents as { defaults: { model: { primary: string } } }).defaults.model.primary)
      .toBe('openrouter/openai/gpt-4.1-mini');

    const authProfiles = await readAuthProfiles('main');
    expect(
      (authProfiles.profiles as Record<string, { key: string }>)['openrouter:default'].key,
    ).toBe('sk-test-openrouter');

    const backups = await readdir(join(testHome, '.openclaw'));
    expect(backups.some((entry) => entry.includes('openclaw.json.repaired-') && entry.endsWith('.bak'))).toBe(true);
  });

  it('reinstalls a damaged bundled plugin mirror during upgrade when the old target is incomplete', async () => {
    const pluginId = 'test-upgrade-plugin';
    const sourceDir = join(process.cwd(), 'build', 'openclaw-plugins', pluginId);
    const targetDir = join(testHome, '.openclaw', 'extensions', pluginId);

    await writePlugin(sourceDir, pluginId, '2.0.0', { withNodeModules: true });
    await writePlugin(targetDir, pluginId, '2.0.0');

    const { ensureBundledPluginInstalled } = await import('@electron/utils/bundled-plugin-installer');
    const result = ensureBundledPluginInstalled(pluginId, 'Test Upgrade Plugin');

    expect(result.installed).toBe(true);
    const targetDepPkg = await readFile(join(targetDir, 'node_modules', 'dep', 'package.json'), 'utf8');
    expect(JSON.parse(targetDepPkg)).toMatchObject({ name: 'dep', version: '1.0.0' });
  });

  it('cleans invalid managed channel plugin manifests before sanitizing config and reinstalls the bundled plugin', async () => {
    await writeOpenClawJson({
      channels: {
        wecom: {
          enabled: true,
          accounts: {
            corp: {
              botId: 'corp',
              secret: 'secret',
            },
          },
          defaultAccount: 'corp',
        },
      },
      plugins: {
        allow: ['channels'],
      },
    });

    const sourceDir = join(process.cwd(), 'build', 'openclaw-plugins', 'channels');
    const targetDir = join(testHome, '.openclaw', 'extensions', 'channels');

    await writePlugin(sourceDir, 'channels', '3.0.0');
    await mkdir(targetDir, { recursive: true });
    await writeFile(
      join(targetDir, 'openclaw.plugin.json'),
      JSON.stringify({ id: 'channels', name: 'China Channels' }, null, 2),
      'utf8',
    );
    await writeFile(
      join(targetDir, 'package.json'),
      JSON.stringify({ name: 'channels', version: '1.0.0' }, null, 2),
      'utf8',
    );

    const { syncGatewayConfigBeforeLaunch } = await import('@electron/gateway/config-sync');

    await syncGatewayConfigBeforeLaunch({
      theme: 'system',
      language: 'zh',
      startMinimized: false,
      launchAtStartup: false,
      gatewayAutoStart: true,
      gatewayPort: 18789,
      gatewayToken: 'test-token',
      proxyMode: 'system',
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
      updateChannel: 'stable',
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      skippedVersions: [],
      sidebarCollapsed: false,
      devModeUnlocked: false,
      setupComplete: false,
      selectedBundles: [],
      enabledSkills: [],
      disabledSkills: [],
      securityPolicy: {
        enabled: false,
        deniedPaths: [],
        permissions: {
          denyRuntime: false,
          denyWrite: false,
          denyRead: false,
          denyBrowser: false,
          denyWebSearch: false,
          denyWebFetch: false,
          denyGateway: false,
        },
      },
      reminders: [],
      sessionMemoryEnabled: true,
      memorySearchEnabled: true,
    });
    await flushBackgroundWork();

    const manifest = JSON.parse(await readFile(join(targetDir, 'openclaw.plugin.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest.configSchema).toEqual({ type: 'object' });
    const config = await readOpenClawJson();
    expect(config.plugins).toEqual({
      allow: ['channels'],
      enabled: true,
      entries: {
        channels: { enabled: true },
      },
    });
  });

  it('syncs runtime auth for every configured agent during upgrade, not just the main agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'analyst',
            name: 'Analyst',
            workspace: '~/.openclaw/workspace-analyst',
            agentDir: '~/.openclaw/agents/analyst/agent',
          },
        ],
        defaults: {
          model: {
            primary: 'anthropic/claude-old',
            fallbacks: [],
          },
        },
      },
    });

    storeState.stores.set('clawclaw-providers', {
      schemaVersion: 1,
      providers: {},
      providerAccounts: {
        openrouter: {
          id: 'openrouter',
          vendorId: 'openrouter',
          label: 'OpenRouter',
          authMode: 'api_key',
          model: 'openai/gpt-4.1-mini',
          enabled: true,
          isDefault: true,
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-02T00:00:00.000Z',
        },
      },
      apiKeys: {
        openrouter: 'sk-test-openrouter',
      },
      providerSecrets: {
        openrouter: {
          type: 'api_key',
          accountId: 'openrouter',
          apiKey: 'sk-test-openrouter',
        },
      },
      defaultProvider: 'openrouter',
      defaultProviderAccountId: 'openrouter',
    });

    const { syncGatewayConfigBeforeLaunch } = await import('@electron/gateway/config-sync');

    await syncGatewayConfigBeforeLaunch({
      theme: 'system',
      language: 'zh',
      startMinimized: false,
      launchAtStartup: false,
      gatewayAutoStart: true,
      gatewayPort: 18789,
      gatewayToken: 'test-token',
      proxyMode: 'system',
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
      updateChannel: 'stable',
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      skippedVersions: [],
      sidebarCollapsed: false,
      devModeUnlocked: false,
      setupComplete: false,
      selectedBundles: [],
      enabledSkills: [],
      disabledSkills: [],
      securityPolicy: {
        enabled: false,
        deniedPaths: [],
        permissions: {
          denyRuntime: false,
          denyWrite: false,
          denyRead: false,
          denyBrowser: false,
          denyWebSearch: false,
          denyWebFetch: false,
          denyGateway: false,
        },
      },
      reminders: [],
      sessionMemoryEnabled: true,
      memorySearchEnabled: true,
    });
    await flushBackgroundWork();

    const mainProfiles = await readAuthProfiles('main');
    const analystProfiles = await readAuthProfiles('analyst');

    expect(
      (mainProfiles.profiles as Record<string, { key: string }>)['openrouter:default'].key,
    ).toBe('sk-test-openrouter');
    expect(
      (analystProfiles.profiles as Record<string, { key: string }>)['openrouter:default'].key,
    ).toBe('sk-test-openrouter');
  });

  it('cleans orphan local model runtime accounts during startup preflight instead of mutating provider state from the chat UI', async () => {
    storeState.stores.set('clawclaw-providers', {
      schemaVersion: 1,
      providers: {},
      providerAccounts: {
        'local-model-stale': {
          id: 'local-model-stale',
          vendorId: 'local-model',
          label: 'ClawClaw',
          authMode: 'api_key',
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiProtocol: 'openai-completions',
          model: 'ClawClaw',
          enabled: true,
          isDefault: true,
          metadata: {
            localModel: true,
          },
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-02T00:00:00.000Z',
        },
      },
      apiKeys: {
        'local-model-stale': 'ollama-local',
      },
      providerSecrets: {
        'local-model-stale': {
          type: 'local',
          accountId: 'local-model-stale',
          apiKey: 'ollama-local',
        },
      },
      defaultProvider: 'local-model-stale',
      defaultProviderAccountId: 'local-model-stale',
    });

    const { syncGatewayConfigBeforeLaunch } = await import('@electron/gateway/config-sync');
    const { getClawXProviderStore } = await import('@electron/services/providers/store-instance');

    await syncGatewayConfigBeforeLaunch({
      theme: 'system',
      language: 'zh',
      startMinimized: false,
      launchAtStartup: false,
      gatewayAutoStart: true,
      gatewayPort: 18789,
      gatewayToken: 'test-token',
      proxyMode: 'system',
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
      updateChannel: 'stable',
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      skippedVersions: [],
      sidebarCollapsed: false,
      devModeUnlocked: false,
      setupComplete: false,
      selectedBundles: [],
      enabledSkills: [],
      disabledSkills: [],
      securityPolicy: {
        enabled: false,
        deniedPaths: [],
        permissions: {
          denyRuntime: false,
          denyWrite: false,
          denyRead: false,
          denyBrowser: false,
          denyWebSearch: false,
          denyWebFetch: false,
          denyGateway: false,
        },
      },
      reminders: [],
      sessionMemoryEnabled: true,
      memorySearchEnabled: true,
    });
    await flushBackgroundWork();

    const store = await getClawXProviderStore();
    expect(store.get('defaultProviderAccountId')).toBeUndefined();
    expect(store.get('defaultProvider')).toBeUndefined();
    expect(store.get('providerAccounts')).toEqual({});
  });
});
