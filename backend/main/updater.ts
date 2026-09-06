import { app, requestHandlers, type HostWindow } from '../host/desktop';
import { emitDesktop, nativeRequest } from '../host/transport';
import type { AppSettings } from '../utils/store';
type UpdateStatus = { status: string; info?: unknown; error?: string };
export class AppUpdater {
  private status: UpdateStatus = { status: 'idle' };
  private autoDownload = false;
  getStatus() { return this.status; }
  getCurrentVersion() { return app.getVersion(); }
  isSupported() { return app.isPackaged && Boolean(process.env.CLAWCLAW_UPDATER_CONFIGURED); }
  async initializeFromSettings(settings: Pick<AppSettings, 'autoDownloadUpdate' | 'updateChannel'>) { this.autoDownload = settings.autoDownloadUpdate; }
  setChannel(channel: string) { if (channel !== 'stable') throw new Error('Unsupported update channel'); }
  setAutoDownload(value: boolean) { this.autoDownload = value; }
  cancelAutoInstall() { emitDesktop('update:auto-install-countdown', { cancelled: true }); }
  private publish(status: UpdateStatus) { this.status = status; emitDesktop('update:status-changed', status); }
  async checkForUpdates() {
    this.publish({ status: 'checking' });
    try {
      const result = await nativeRequest('update:check');
      this.publish(result);
      if (result.status === 'available' && this.autoDownload) await this.downloadUpdate();
    } catch (error) { this.publish({ status: 'error', error: String(error) }); throw error; }
  }
  async downloadUpdate() {
    this.publish({ ...this.status, status: 'downloading' });
    try { await nativeRequest('update:download'); this.publish({ ...this.status, status: 'downloaded' }); }
    catch (error) { this.publish({ status: 'error', error: String(error) }); throw error; }
  }
  quitAndInstall() { void nativeRequest('update:install').catch(error => this.publish({ status: 'error', error: String(error) })); }
}
export const appUpdater = new AppUpdater();
export function registerUpdateHandlers(updater: AppUpdater, _window: HostWindow) {
  requestHandlers.handle('update:version', () => updater.getCurrentVersion());
  requestHandlers.handle('update:status', () => updater.getStatus());
  requestHandlers.handle('update:isSupported', () => updater.isSupported());
  for (const action of ['check', 'download', 'install'] as const) requestHandlers.handle(`update:${action}`, async () => {
    try {
      if (action === 'check') await updater.checkForUpdates();
      if (action === 'download') await updater.downloadUpdate();
      if (action === 'install') updater.quitAndInstall();
      return { success: true, status: updater.getStatus() };
    } catch (error) { return { success: false, error: String(error), status: updater.getStatus() }; }
  });
  requestHandlers.handle('update:setChannel', (_, channel) => { updater.setChannel(channel); return { success: true }; });
  requestHandlers.handle('update:setAutoDownload', (_, value) => { updater.setAutoDownload(value); return { success: true }; });
  requestHandlers.handle('update:cancelAutoInstall', () => { updater.cancelAutoInstall(); return { success: true }; });
}
