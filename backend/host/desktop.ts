import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitDesktop, nativeRequest } from './transport';
export { requestHandlers } from './transport';
const root = process.env.CLAWCLAW_APP_ROOT || process.cwd();
const defaultData = process.platform === 'win32'
  ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'clawclaw')
  : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'clawclaw')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'clawclaw');
export const resourcesPath = process.env.CLAWCLAW_RESOURCES || join(root, 'resources');
export const app = {
  isPackaged: process.env.CLAWCLAW_PACKAGED === '1',
  getAppPath: () => root,
  getVersion: () => process.env.CLAWCLAW_VERSION || '0.1.23',
  getName: () => 'ClawClaw',
  getLocale: () => Intl.DateTimeFormat().resolvedOptions().locale,
  isReady: () => true,
  whenReady: async () => {},
  getPath(name: string): string {
    const paths: Record<string, string> = { userData: process.env.CLAWCLAW_DATA_DIR || defaultData, temp: tmpdir(), home: homedir(), exe: process.execPath, appData: join(defaultData, '..'), downloads: join(homedir(), 'Downloads'), desktop: join(homedir(), 'Desktop') };
    if (name === 'logs') return join(paths.userData, 'logs');
    if (!paths[name]) throw new Error(`Unsupported desktop path: ${name}`);
    return paths[name];
  },
  quit: () => { void nativeRequest('app:quit'); },
  relaunch: () => { void nativeRequest('app:relaunch'); },
};
export type App = typeof app;
/** Endpoint for the single Tauri window; owns no browser or rendering engine. */
export class HostWindow {
  webContents = { send: emitDesktop };
  isDestroyed() { return false; }
  minimize() { return nativeRequest('window:minimize'); }
  maximize() { return nativeRequest('window:maximize'); }
  unmaximize() { return nativeRequest('window:unmaximize'); }
  isMaximized(): Promise<boolean> { return nativeRequest('window:isMaximized'); }
  close() { return nativeRequest('window:close'); }
}
export const shell = {
  openExternal: (url: string): Promise<void> => nativeRequest('shell:openExternal', url),
  openPath: (path: string): Promise<string> => nativeRequest('shell:openPath', path),
  showItemInFolder: (path: string): Promise<void> => nativeRequest('shell:showItemInFolder', path),
};
export const dialog = {
  showOpenDialog: (options: Record<string, any>): Promise<{ canceled: boolean; filePaths: string[] }> => nativeRequest('dialog:open', options),
  showSaveDialog: (options: Record<string, any>): Promise<{ canceled: boolean; filePath?: string }> => nativeRequest('dialog:save', options),
  showMessageBox: (options: Record<string, any>): Promise<{ response: number; checkboxChecked: boolean }> => nativeRequest('dialog:message', options),
};
