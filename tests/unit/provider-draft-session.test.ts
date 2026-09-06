import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawclaw-provider-draft-${suffix}`,
    testUserData: `/tmp/clawclaw-provider-draft-user-data-${suffix}`,
  };
});

const storeState = vi.hoisted(() => ({
  stores: new Map<string, Record<string, unknown>>(),
}));

vi.mock('os', () => {
  const mocked = { homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('../../backend/host/desktop', () => ({
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

vi.mock('../../backend/host/json-store', () => {
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

describe('provider draft session', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    storeState.stores.clear();
  });

  it('restores provider records, secrets, and defaults when discarding a draft session', async () => {
    storeState.stores.set('clawclaw-providers', {
      schemaVersion: 2,
      providers: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          model: 'gpt-5.4',
          enabled: true,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      },
      providerAccounts: {
        openai: {
          id: 'openai',
          vendorId: 'openai',
          label: 'OpenAI',
          authMode: 'api_key',
          model: 'gpt-5.4',
          enabled: true,
          isDefault: true,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      },
      apiKeys: {
        openai: 'sk-old',
      },
      providerSecrets: {
        openai: {
          type: 'api_key',
          accountId: 'openai',
          apiKey: 'sk-old',
        },
      },
      defaultProvider: 'openai',
      defaultProviderAccountId: 'openai',
    });

    const { beginProviderDraftSession, discardProviderDraftSession } = await import(
      '@backend/services/provider-draft-session'
    );
    const { getProviderService } = await import('@backend/services/providers/provider-service');
    const { getClawXProviderStore } = await import('@backend/services/providers/store-instance');

    await beginProviderDraftSession();

    const providerService = getProviderService();
    await providerService.updateAccount('openai', {
      label: 'OpenAI Updated',
      model: 'gpt-5.5',
      updatedAt: '2026-05-02T00:00:00.000Z',
    }, 'sk-new');
    await providerService.createAccount({
      id: 'moonshot',
      vendorId: 'moonshot',
      label: 'Moonshot',
      authMode: 'api_key',
      model: 'kimi-k2.5',
      enabled: true,
      isDefault: false,
      createdAt: '2026-05-02T00:00:00.000Z',
      updatedAt: '2026-05-02T00:00:00.000Z',
    }, 'moonshot-key');
    await providerService.setDefaultAccount('moonshot');

    await discardProviderDraftSession();

    const store = await getClawXProviderStore();
    expect(store.get('defaultProvider')).toBe('openai');
    expect(store.get('defaultProviderAccountId')).toBe('openai');
    expect(store.get('providerAccounts')).toEqual({
      openai: expect.objectContaining({
        id: 'openai',
        label: 'OpenAI',
        model: 'gpt-5.4',
        isDefault: true,
      }),
    });
    expect(store.get('providers')).toEqual({
      openai: expect.objectContaining({
        id: 'openai',
        name: 'OpenAI',
        model: 'gpt-5.4',
      }),
    });
    expect(store.get('apiKeys')).toEqual({ openai: 'sk-old' });
    expect(store.get('providerSecrets')).toEqual({
      openai: {
        type: 'api_key',
        accountId: 'openai',
        apiKey: 'sk-old',
      },
    });
  });
});
