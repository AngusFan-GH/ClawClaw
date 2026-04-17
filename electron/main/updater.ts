/**
 * Auto-Updater Module
 * Handles automatic application updates using electron-updater
 */
import { autoUpdater, UpdateInfo, ProgressInfo, UpdateDownloadedEvent } from 'electron-updater';
import { BrowserWindow, app, ipcMain } from 'electron';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import type { AppSettings } from '../utils/store';
import { UPDATE_FEEDS, type UpdateChannel } from '../shared/update-feed';
import { markAppQuitting } from './quit';
import { getPortableDataDir } from '../utils/paths';
import { portableUpdater } from './portable-updater';

type FeedConfig = {
  channel: UpdateChannel;
  provider: 'generic';
  url: string;
  allowPrerelease: boolean;
};

const FEED_CONFIGS: Record<UpdateChannel, FeedConfig> = Object.fromEntries(
  Object.entries(UPDATE_FEEDS).map(([channel, config]) => [
    channel,
    {
      channel: channel as UpdateChannel,
      provider: 'generic',
      url: config.url,
      allowPrerelease: config.allowPrerelease,
    },
  ]),
) as Record<UpdateChannel, FeedConfig>;

function detectVersionChannel(_version: string): UpdateChannel {
  return 'stable';
}

function normalizeChannel(_channel?: string | null): UpdateChannel {
  return 'stable';
}

export interface UpdateStatus {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'migration-required'
    | 'error';
  info?: UpdateInfo;
  progress?: ProgressInfo;
  error?: string;
}

export interface UpdaterEvents {
  'status-changed': (status: UpdateStatus) => void;
  'checking-for-update': () => void;
  'update-available': (info: UpdateInfo) => void;
  'update-not-available': (info: UpdateInfo) => void;
  'download-progress': (progress: ProgressInfo) => void;
  'update-downloaded': (event: UpdateDownloadedEvent) => void;
  'error': (error: Error) => void;
}

export class AppUpdater extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = { status: 'idle' };
  private autoInstallTimer: NodeJS.Timeout | null = null;
  private autoInstallCountdown = 0;
  private configuredChannel: UpdateChannel = detectVersionChannel(app.getVersion());

  private static readonly AUTO_INSTALL_DELAY_SECONDS = 5;

  constructor() {
    super();

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (msg: string) => logger.info('[Updater]', msg),
      warn: (msg: string) => logger.warn('[Updater]', msg),
      error: (msg: string) => logger.error('[Updater]', msg),
      debug: (msg: string) => logger.debug('[Updater]', msg),
    };

    this.applyFeedConfig(FEED_CONFIGS[this.configuredChannel]);
    this.setupListeners();
  }

  async initializeFromSettings(
    settings: Pick<AppSettings, 'updateChannel' | 'autoDownloadUpdate'>,
  ): Promise<void> {
    const preferredChannel = normalizeChannel(settings.updateChannel);
    this.setChannel(preferredChannel);
    this.setAutoDownload(Boolean(settings.autoDownloadUpdate));
  }

  private applyFeedConfig(config: FeedConfig): void {
    autoUpdater.allowPrerelease = config.allowPrerelease;

    // Keep generic provider filenames stable as latest.yml across directories.
    autoUpdater.channel = 'latest';

    autoUpdater.setFeedURL({
      provider: 'generic',
      url: config.url,
      useMultipleRangeRequest: false,
    });
    logger.info(
      `[Updater] feed configured channel=${config.channel} url=${config.url} allowPrerelease=${config.allowPrerelease}`,
    );
  }

  private configureFeed(channel: UpdateChannel): void {
    this.configuredChannel = channel;
    this.applyFeedConfig(FEED_CONFIGS[channel]);
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  getCurrentVersion(): string {
    return app.getVersion();
  }

  getChannel(): UpdateChannel {
    return this.configuredChannel;
  }

  isSupported(): boolean {
    return app.isPackaged && getPortableDataDir() === null;
  }

  private setupListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.updateStatus({ status: 'checking', error: undefined });
      this.emit('checking-for-update');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.updateStatus({ status: 'available', info, error: undefined });
      this.emit('update-available', info);
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.updateStatus({ status: 'not-available', info, error: undefined });
      this.emit('update-not-available', info);
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.updateStatus({ status: 'downloading', progress, error: undefined });
      this.emit('download-progress', progress);
    });

    autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      this.updateStatus({ status: 'downloaded', info: event, error: undefined });
      this.emit('update-downloaded', event);

      if (autoUpdater.autoDownload) {
        this.startAutoInstallCountdown();
      }
    });

    autoUpdater.on('error', (error: Error) => {
      this.updateStatus({ status: 'error', error: error.message });
      this.emit('error', error);
    });
  }

  private updateStatus(newStatus: Partial<UpdateStatus>): void {
    this.status = {
      status: newStatus.status ?? this.status.status,
      info: newStatus.info,
      progress: newStatus.progress,
      error: newStatus.error,
    };
    this.sendToRenderer('update:status-changed', this.status);
  }

  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  async checkForUpdates(): Promise<UpdateInfo | null> {
    if (!app.isPackaged) {
      this.updateStatus({
        status: 'error',
        error: 'Update check skipped (dev mode – app is not packaged)',
      });
      return null;
    }

    try {
      this.configureFeed(this.configuredChannel);
      return await this.checkWithCurrentFeed();
    } catch (error) {
      logger.error('[Updater] Update check failed:', error);
      this.updateStatus({
        status: 'error',
        error: (error as Error).message || String(error),
      });
      throw error;
    }
  }

  private async checkWithCurrentFeed(): Promise<UpdateInfo | null> {
    const result = await autoUpdater.checkForUpdates();
    if (result == null) {
      this.updateStatus({
        status: 'error',
        error: 'Update check returned no result',
      });
      return null;
    }

    if (this.status.status === 'checking' || this.status.status === 'idle') {
      this.updateStatus({ status: 'not-available', error: undefined });
    }

    return result.updateInfo || null;
  }

  async downloadUpdate(): Promise<void> {
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      logger.error('[Updater] Download update failed:', error);
      throw error;
    }
  }

  quitAndInstall(): void {
    logger.info('[Updater] quitAndInstall called');
    markAppQuitting();
    autoUpdater.quitAndInstall();
  }

  private startAutoInstallCountdown(): void {
    this.clearAutoInstallTimer();
    this.autoInstallCountdown = AppUpdater.AUTO_INSTALL_DELAY_SECONDS;
    this.sendToRenderer('update:auto-install-countdown', { seconds: this.autoInstallCountdown });

    this.autoInstallTimer = setInterval(() => {
      this.autoInstallCountdown--;
      this.sendToRenderer('update:auto-install-countdown', { seconds: this.autoInstallCountdown });

      if (this.autoInstallCountdown <= 0) {
        this.clearAutoInstallTimer();
        this.quitAndInstall();
      }
    }, 1000);
  }

  cancelAutoInstall(): void {
    this.clearAutoInstallTimer();
    this.sendToRenderer('update:auto-install-countdown', { seconds: -1, cancelled: true });
  }

  private clearAutoInstallTimer(): void {
    if (this.autoInstallTimer) {
      clearInterval(this.autoInstallTimer);
      this.autoInstallTimer = null;
    }
  }

  setChannel(channel: UpdateChannel): void {
    this.configureFeed(normalizeChannel(channel));
  }

  setAutoDownload(enable: boolean): void {
    autoUpdater.autoDownload = enable;
  }
}

export function registerUpdateHandlers(
  updater: AppUpdater,
  mainWindow: BrowserWindow,
): void {
  updater.setMainWindow(mainWindow);
  portableUpdater.setMainWindow(mainWindow);

  const getActiveUpdater = () => (portableUpdater.isSupported() ? portableUpdater : updater);

  const unsupportedResult = () => ({
    success: false,
    error: 'Automatic updates are not available in the current environment.',
    status: getActiveUpdater().getStatus(),
  });

  ipcMain.handle('update:status', () => getActiveUpdater().getStatus());
  ipcMain.handle('update:version', () => getActiveUpdater().getCurrentVersion());
  ipcMain.handle('update:isSupported', () => updater.isSupported() || portableUpdater.isSupported());

  ipcMain.handle('update:check', async () => {
    const activeUpdater = getActiveUpdater();
    if (!(updater.isSupported() || portableUpdater.isSupported())) return unsupportedResult();
    try {
      await activeUpdater.checkForUpdates();
      return { success: true, status: activeUpdater.getStatus() };
    } catch (error) {
      return { success: false, error: String(error), status: activeUpdater.getStatus() };
    }
  });

  ipcMain.handle('update:download', async () => {
    const activeUpdater = getActiveUpdater();
    if (!(updater.isSupported() || portableUpdater.isSupported())) return unsupportedResult();
    try {
      await activeUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('update:install', () => {
    const activeUpdater = getActiveUpdater();
    if (!(updater.isSupported() || portableUpdater.isSupported())) return unsupportedResult();
    if (activeUpdater === portableUpdater) {
      portableUpdater.installUpdate();
    } else {
      updater.quitAndInstall();
    }
    return { success: true };
  });

  ipcMain.handle('update:setChannel', (_, channel: UpdateChannel) => {
    if (!(updater.isSupported() || portableUpdater.isSupported())) return unsupportedResult();
    updater.setChannel(channel);
    portableUpdater.setChannel(channel);
    return { success: true };
  });

  ipcMain.handle('update:setAutoDownload', (_, enable: boolean) => {
    if (!updater.isSupported()) return unsupportedResult();
    updater.setAutoDownload(enable);
    return { success: true };
  });

  ipcMain.handle('update:cancelAutoInstall', () => {
    if (!updater.isSupported()) return unsupportedResult();
    updater.cancelAutoInstall();
    return { success: true };
  });
}

export const appUpdater = new AppUpdater();
