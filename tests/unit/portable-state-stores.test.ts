import { beforeEach, describe, expect, it, vi } from 'vitest';

const testUserData = vi.hoisted(() => `/tmp/clawclaw-portable-state-${Math.random().toString(36).slice(2)}`);

const storeCalls = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
}));

const mockFns = vi.hoisted(() => ({
  ensureProviderStoreMigrated: vi.fn(async () => undefined),
  runOpenClawStartupPreflightRepair: vi.fn(async () => undefined),
  getLastStartupPreflightRecovery: vi.fn(() => null),
  cleanupDanglingWeChatPluginState: vi.fn(async () => ({ cleanedDanglingState: false })),
  cleanupLegacyChannelPlugins: vi.fn(async () => ({ cleaned: false })),
  migrateLegacyLocalModelAccounts: vi.fn(async () => undefined),
  cleanupOrphanLocalModelRuntimeAccounts: vi.fn(async () => ({ removedAccountIds: [] })),
  runOpenClawDoctorFix: vi.fn(async () => ({
    mode: 'fix',
    status: 'success',
    success: true,
    exitCode: 0,
    stdout: '',
    stderr: '',
    command: 'openclaw doctor --fix --yes --non-interactive',
    cwd: '/tmp/openclaw',
    durationMs: 10,
    warnings: [],
  })),
  readFile: vi.fn(async () => JSON.stringify({ version: '2026.4.15' })),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => testUserData,
    getAppPath: () => process.cwd(),
    getVersion: () => '0.1.16',
  },
  screen: {
    getAllDisplays: () => [],
  },
}));

vi.mock('electron-store', () => {
  class MockStore {
    private readonly data: Record<string, unknown>;

    constructor(options?: Record<string, unknown>) {
      storeCalls.options.push(options ?? {});
      this.data = structuredClone((options?.defaults || {}) as Record<string, unknown>);
    }

    get(key?: string): unknown {
      if (!key) return this.data;
      return this.data[key];
    }

    set(key: string, value: unknown): void {
      this.data[key] = value;
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

vi.mock('@electron/services/providers/provider-migration', () => ({
  ensureProviderStoreMigrated: mockFns.ensureProviderStoreMigrated,
}));

vi.mock('@electron/gateway/config-sync', () => ({
  runOpenClawStartupPreflightRepair: mockFns.runOpenClawStartupPreflightRepair,
  getLastStartupPreflightRecovery: mockFns.getLastStartupPreflightRecovery,
}));

vi.mock('@electron/utils/channel-config', () => ({
  cleanupDanglingWeChatPluginState: mockFns.cleanupDanglingWeChatPluginState,
  cleanupLegacyChannelPlugins: mockFns.cleanupLegacyChannelPlugins,
}));

vi.mock('@electron/services/providers/local-model-presets', () => ({
  migrateLegacyLocalModelAccounts: mockFns.migrateLegacyLocalModelAccounts,
  cleanupOrphanLocalModelRuntimeAccounts: mockFns.cleanupOrphanLocalModelRuntimeAccounts,
}));

vi.mock('@electron/utils/openclaw-doctor', () => ({
  OPENCLAW_DOCTOR_FIX_TIMEOUT_MS: 120_000,
  runOpenClawDoctorFix: mockFns.runOpenClawDoctorFix,
}));

describe('portable state stores', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storeCalls.options.length = 0;
  });

  it('persists window state under the portable-aware data directory', async () => {
    const { getWindowState } = await import('@electron/main/window');

    await getWindowState();

    expect(storeCalls.options).toContainEqual(
      expect.objectContaining({
        name: 'window-state',
        cwd: testUserData,
      }),
    );
  });

  it('persists upgrade state under the portable-aware data directory', async () => {
    const { performUpgradeMaintenanceIfNeeded } = await import('@electron/utils/upgrade-maintenance');

    await performUpgradeMaintenanceIfNeeded();

    expect(storeCalls.options).toContainEqual(
      expect.objectContaining({
        name: 'upgrade-state',
        cwd: testUserData,
      }),
    );
  });
});
