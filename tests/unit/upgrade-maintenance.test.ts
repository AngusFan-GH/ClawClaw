import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  stores: new Map<string, Record<string, unknown>>(),
}));

const mockFns = vi.hoisted(() => ({
  ensureProviderStoreMigrated: vi.fn(async () => undefined),
  runOpenClawStartupPreflightRepair: vi.fn(async () => undefined),
  runOpenClawDoctorRepair: vi.fn(async () => true),
  readFile: vi.fn(async () => JSON.stringify({ version: '2026.4.2' })),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.16',
    isPackaged: false,
    getPath: () => '/tmp/clawclaw-upgrade-maintenance',
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    private readonly name: string;
    constructor(options?: { name?: string; defaults?: T }) {
      this.name = options?.name || 'default';
      if (!storeState.stores.has(this.name)) {
        storeState.stores.set(this.name, structuredClone((options?.defaults || {}) as T) as Record<string, unknown>);
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
  }
  return { default: MockStore };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: actual,
    readFile: mockFns.readFile,
  };
});

vi.mock('@electron/services/providers/provider-migration', () => ({
  ensureProviderStoreMigrated: mockFns.ensureProviderStoreMigrated,
}));

vi.mock('@electron/gateway/config-sync', () => ({
  runOpenClawStartupPreflightRepair: mockFns.runOpenClawStartupPreflightRepair,
}));

vi.mock('@electron/gateway/supervisor', () => ({
  runOpenClawDoctorRepair: mockFns.runOpenClawDoctorRepair,
}));

describe('upgrade maintenance', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storeState.stores.clear();
    mockFns.readFile.mockResolvedValue(JSON.stringify({ version: '2026.4.2' }));
  });

  it('runs once when current versions have not been recorded yet', async () => {
    const { performUpgradeMaintenanceIfNeeded } = await import('@electron/utils/upgrade-maintenance');

    const result = await performUpgradeMaintenanceIfNeeded();

    expect(result.triggered).toBe(true);
    expect(mockFns.ensureProviderStoreMigrated).toHaveBeenCalledTimes(1);
    expect(mockFns.runOpenClawStartupPreflightRepair).toHaveBeenCalledTimes(1);
    expect(mockFns.runOpenClawDoctorRepair).toHaveBeenCalledTimes(1);
  });

  it('does not rerun when recorded versions already match the current app and openclaw', async () => {
    storeState.stores.set('upgrade-state', {
      lastAppVersion: '0.1.16',
      lastOpenClawVersion: '2026.4.2',
    });

    const { performUpgradeMaintenanceIfNeeded } = await import('@electron/utils/upgrade-maintenance');

    const result = await performUpgradeMaintenanceIfNeeded();

    expect(result.triggered).toBe(false);
    expect(mockFns.ensureProviderStoreMigrated).not.toHaveBeenCalled();
    expect(mockFns.runOpenClawStartupPreflightRepair).not.toHaveBeenCalled();
    expect(mockFns.runOpenClawDoctorRepair).not.toHaveBeenCalled();
  });
});
