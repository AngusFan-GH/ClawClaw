import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockApp = vi.hoisted(() => ({
  isPackaged: true,
  getVersion: () => '0.1.16',
  getPath: (name: string) => {
    if (name === 'exe') return '/portable/ClawClaw.exe';
    return '/tmp';
  },
  quit: vi.fn(),
}));

const mockPaths = vi.hoisted(() => ({
  getPortableDataDir: vi.fn(() => '/portable/portable'),
}));

describe('portable updater', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('treats manifests below minimumAppVersion as migration-required', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        version: '0.1.17',
        releaseDate: '2026-04-17T00:00:00.000Z',
        layoutVersion: 2,
        minimumAppVersion: '0.1.18',
        artifact: {
          url: 'https://example.com/portable.zip',
          sha512: 'abc',
          size: 123,
        },
      }),
    })) as typeof fetch);

    vi.doMock('electron', () => ({
      app: mockApp,
      BrowserWindow: class {},
    }));
    vi.doMock('@electron/utils/paths', () => mockPaths);
    vi.doMock('@electron/main/quit', () => ({
      markAppQuitting: vi.fn(),
    }));

    const { PortableUpdater } = await import('@electron/main/portable-updater');
    const updater = new PortableUpdater();
    const result = await updater.checkForUpdates();

    expect(result?.minimumAppVersion).toBe('0.1.18');
    expect(updater.getStatus().status).toBe('migration-required');
  });
});
