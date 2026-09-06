import { beforeEach, describe, expect, it, vi } from 'vitest';

const testUserData = vi.hoisted(() => `/tmp/clawclaw-provider-store-${Math.random().toString(36).slice(2)}`);

const storeCalls = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../backend/host/desktop', () => ({
  app: {
    isPackaged: true,
    getPath: () => testUserData,
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('../../backend/host/json-store', () => {
  class MockStore {
    constructor(options?: Record<string, unknown>) {
      storeCalls.options.push(options ?? {});
    }
  }

  return { default: MockStore };
});

describe('provider store instance', () => {
  beforeEach(() => {
    vi.resetModules();
    storeCalls.options.length = 0;
  });

  it('uses the app data directory as electron-store cwd', async () => {
    const { getClawXProviderStore } = await import('@backend/services/providers/store-instance');

    await getClawXProviderStore();

    expect(storeCalls.options).toHaveLength(1);
    expect(storeCalls.options[0]).toMatchObject({
      name: 'clawclaw-providers',
      cwd: testUserData,
    });
  });
});
