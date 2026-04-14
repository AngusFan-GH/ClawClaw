import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIpcMain = vi.hoisted(() => ({
  handle: vi.fn(),
}));

const mockAutoUpdater = vi.hoisted(() => ({
  autoDownload: false,
  autoInstallOnAppQuit: true,
  logger: null as unknown,
  allowPrerelease: false,
  channel: 'latest',
  setFeedURL: vi.fn(),
  on: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: {
    isPackaged: true,
    getVersion: () => '0.1.16',
  },
  ipcMain: mockIpcMain,
}));

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

vi.mock('@electron/utils/paths', () => ({
  getPortableBase: () => '/tmp/portable-app',
}));

vi.mock('@electron/main/quit', () => ({
  markAppQuitting: vi.fn(),
}));

describe('updater portable mode', () => {
  beforeEach(() => {
    vi.resetModules();
    mockIpcMain.handle.mockReset();
    mockAutoUpdater.setFeedURL.mockReset();
    mockAutoUpdater.on.mockReset();
  });

  it('disables updater support for portable builds', async () => {
    const { AppUpdater } = await import('@electron/main/updater');

    const updater = new AppUpdater();

    expect(updater.isSupported()).toBe(false);
  });
});
