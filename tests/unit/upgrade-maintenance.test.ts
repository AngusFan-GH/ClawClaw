import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  stores: new Map<string, Record<string, unknown>>(),
}));

const mockFns = vi.hoisted(() => ({
  ensureProviderStoreMigrated: vi.fn(async () => undefined),
  runOpenClawStartupPreflightRepair: vi.fn(async () => undefined),
  getLastStartupPreflightRecovery: vi.fn(() => ({ kind: 'preflight', topics: ['config'] })),
  cleanupDanglingWeChatPluginState: vi.fn(async () => ({ cleanedDanglingState: false })),
  cleanupLegacyChannelPlugins: vi.fn(async () => ({ cleaned: false })),
  migrateLegacyLocalModelAccounts: vi.fn(async () => undefined),
  cleanupOrphanLocalModelRuntimeAccounts: vi.fn(async () => ({ removedAccountIds: [] })),
  runOpenClawDoctorFix: vi.fn(async () => ({
    mode: 'fix',
    status: 'success_with_warnings',
    success: true,
    exitCode: 0,
    stdout: '',
    stderr: 'warning',
    command: 'openclaw doctor --fix --yes --non-interactive',
    cwd: '/tmp/openclaw',
    durationMs: 10,
    warnings: ['warning'],
  })),
  readFile: vi.fn(async () => JSON.stringify({ version: '2026.4.15' })),
}));

vi.mock('../../backend/host/desktop', () => ({
  app: {
    getVersion: () => '0.1.16',
    isPackaged: false,
    getPath: () => '/tmp/clawclaw-upgrade-maintenance',
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('../../backend/host/json-store', () => {
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
    readFile: mockFns.readFile,
    default: {
      ...actual,
      readFile: mockFns.readFile,
    },
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: mockFns.readFile,
    default: {
      ...actual,
      readFile: mockFns.readFile,
    },
  };
});

vi.mock('@backend/services/providers/provider-migration', () => ({
  ensureProviderStoreMigrated: mockFns.ensureProviderStoreMigrated,
}));

vi.mock('@backend/gateway/config-sync', () => ({
  runOpenClawStartupPreflightRepair: mockFns.runOpenClawStartupPreflightRepair,
  getLastStartupPreflightRecovery: mockFns.getLastStartupPreflightRecovery,
}));

vi.mock('@backend/utils/channel-config', () => ({
  cleanupDanglingWeChatPluginState: mockFns.cleanupDanglingWeChatPluginState,
  cleanupLegacyChannelPlugins: mockFns.cleanupLegacyChannelPlugins,
}));

vi.mock('@backend/services/providers/local-model-presets', () => ({
  migrateLegacyLocalModelAccounts: mockFns.migrateLegacyLocalModelAccounts,
  cleanupOrphanLocalModelRuntimeAccounts: mockFns.cleanupOrphanLocalModelRuntimeAccounts,
}));

vi.mock('@backend/utils/openclaw-doctor', () => ({
  OPENCLAW_DOCTOR_FIX_TIMEOUT_MS: 120_000,
  runOpenClawDoctorFix: mockFns.runOpenClawDoctorFix,
}));

describe('upgrade maintenance', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storeState.stores.clear();
    mockFns.readFile.mockResolvedValue(JSON.stringify({ version: '2026.4.15' }));
  });

  it('runs once when current versions have not been recorded yet', async () => {
    const { performUpgradeMaintenanceIfNeeded } = await import('@backend/utils/upgrade-maintenance');

    const result = await performUpgradeMaintenanceIfNeeded();

    expect(result.triggered).toBe(true);
    expect(result.preflightRan).toBe(true);
    expect(result.preflightRecoveredTopics).toEqual(['config']);
    expect(result.doctorFixRan).toBe(true);
    expect(result.doctorFixStatus).toBe('success_with_warnings');
    expect(result.doctorFixWarningCount).toBe(1);
    expect(mockFns.ensureProviderStoreMigrated).toHaveBeenCalledTimes(1);
    expect(mockFns.runOpenClawStartupPreflightRepair).toHaveBeenCalledTimes(1);
    expect(mockFns.runOpenClawDoctorFix).toHaveBeenCalledTimes(1);
    expect(mockFns.runOpenClawDoctorFix).toHaveBeenCalledWith({ timeoutMs: 120_000 });

    const persisted = storeState.stores.get('upgrade-state') || {};
    expect(persisted.lastPreflightOpenClawVersion).toBe('2026.4.15');
    expect(persisted.lastDoctorFixOpenClawVersion).toBe('2026.4.15');
    expect(persisted.lastDoctorFixStatus).toBe('success_with_warnings');
    expect(persisted.lastDoctorFixWarningCount).toBe(1);
  });

  it('does not rerun when recorded versions already match the current app and openclaw', async () => {
    storeState.stores.set('upgrade-state', {
      lastAppVersion: '0.1.16',
      lastOpenClawVersion: '2026.4.15',
    });

    const { performUpgradeMaintenanceIfNeeded } = await import('@backend/utils/upgrade-maintenance');

    const result = await performUpgradeMaintenanceIfNeeded();

    expect(result.triggered).toBe(false);
    expect(result.preflightRan).toBe(false);
    expect(result.doctorFixRan).toBe(false);
    expect(mockFns.ensureProviderStoreMigrated).not.toHaveBeenCalled();
    expect(mockFns.runOpenClawStartupPreflightRepair).not.toHaveBeenCalled();
    expect(mockFns.runOpenClawDoctorFix).not.toHaveBeenCalled();
  });

  it('runs legacy cleanup and forces doctor fix for upgrades from 0.1.15 and earlier', async () => {
    storeState.stores.set('upgrade-state', {
      lastAppVersion: '0.1.15',
      lastOpenClawVersion: '2026.4.15',
    });

    const { performUpgradeMaintenanceIfNeeded, isLegacyInstallUpgradeVersion } = await import('@backend/utils/upgrade-maintenance');

    expect(isLegacyInstallUpgradeVersion('0.1.15')).toBe(true);
    expect(isLegacyInstallUpgradeVersion('0.1.16')).toBe(false);

    const result = await performUpgradeMaintenanceIfNeeded();

    expect(result.triggered).toBe(true);
    expect(result.legacyUpgradeRan).toBe(true);
    expect(result.doctorFixRan).toBe(true);
    expect(mockFns.migrateLegacyLocalModelAccounts).toHaveBeenCalledTimes(1);
    expect(mockFns.cleanupDanglingWeChatPluginState).toHaveBeenCalledTimes(1);
    expect(mockFns.cleanupLegacyChannelPlugins).toHaveBeenCalledTimes(1);
    expect(mockFns.cleanupOrphanLocalModelRuntimeAccounts).toHaveBeenCalledTimes(1);
    expect(mockFns.runOpenClawDoctorFix).toHaveBeenCalledTimes(1);

    const persisted = storeState.stores.get('upgrade-state') || {};
    expect(persisted.lastLegacyUpgradeFromVersion).toBe('0.1.15');
    expect(typeof persisted.lastLegacyUpgradeAt).toBe('string');
  });
});
