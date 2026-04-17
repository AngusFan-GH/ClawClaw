import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawclaw-openclaw-auth-${suffix}`,
    testUserData: `/tmp/clawclaw-openclaw-auth-user-data-${suffix}`,
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
    getAppPath: () => process.cwd(),
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

describe('openclaw auth plugin entry sync', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('enables oauth provider plugins through plugins.entries without creating plugins.allow', async () => {
    await writeOpenClawJson({});

    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncProviderConfigToOpenClaw('qwen-portal', 'qwen-max', {
      baseUrl: 'https://portal.qwen.ai/v1',
      api: 'openai-completions',
    });

    const config = await readOpenClawJson();
    expect(config.plugins).toEqual({
      entries: {
        'qwen-portal-auth': { enabled: true },
      },
    });
  });

  it('keeps syncing oauth plugins into plugins.allow only when an allowlist already exists', async () => {
    await writeOpenClawJson({
      plugins: {
        allow: ['browser'],
      },
    });

    const { setOpenClawDefaultModelWithOverride } = await import('@electron/utils/openclaw-auth');
    await setOpenClawDefaultModelWithOverride('qwen-portal', 'qwen-max', {
      baseUrl: 'https://portal.qwen.ai/v1',
      api: 'openai-completions',
    });

    const config = await readOpenClawJson();
    expect(config.plugins).toEqual({
      allow: ['browser', 'qwen-portal-auth'],
      entries: {
        'qwen-portal-auth': { enabled: true },
      },
    });
  });

  it('migrates legacy Moonshot Kimi web search config into plugins.entries', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          moonshot: {
            baseUrl: 'https://api.moonshot.cn/v1',
            api: 'openai-completions',
          },
        },
      },
      tools: {
        web: {
          search: {
            kimi: {
              apiKey: 'legacy-inline-key',
              timeoutMs: 5000,
            },
          },
        },
      },
    });

    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncProviderConfigToOpenClaw('moonshot', 'kimi-k2.5', {
      baseUrl: 'https://api.moonshot.cn/v1',
      api: 'openai-completions',
      apiKeyEnv: 'MOONSHOT_API_KEY',
    });

    const config = await readOpenClawJson();
    expect(config.tools).toBeUndefined();
    expect(config.plugins).toEqual({
      entries: {
        moonshot: {
          config: {
            webSearch: {
              timeoutMs: 5000,
              baseUrl: 'https://api.moonshot.cn/v1',
            },
          },
        },
      },
    });
  });

  it('writes allowPrivateNetwork into models.providers.request for self-hosted providers', async () => {
    await writeOpenClawJson({});

    const { syncProviderConfigToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncProviderConfigToOpenClaw('custom-runtime', 'my-model', {
      baseUrl: 'http://127.0.0.1:4000/v1',
      api: 'openai-completions',
      allowPrivateNetwork: true,
    });

    const config = await readOpenClawJson();
    expect(config.models).toEqual({
      providers: {
        'custom-runtime': {
          baseUrl: 'http://127.0.0.1:4000/v1',
          api: 'openai-completions',
          models: [{ id: 'my-model', name: 'my-model' }],
          request: {
            allowPrivateNetwork: true,
          },
        },
      },
    });
  });

  it('syncs localModelLean into agents.defaults.experimental', async () => {
    await writeOpenClawJson({});

    const { syncModelRuntimeSettingsToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await syncModelRuntimeSettingsToOpenClaw({ localModelLean: true });

    const config = await readOpenClawJson();
    expect(config.agents).toEqual({
      defaults: {
        experimental: {
          localModelLean: true,
        },
      },
    });
  });
});
