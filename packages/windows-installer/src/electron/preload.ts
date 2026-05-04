import { contextBridge, ipcRenderer } from 'electron';
import type { InstallerBridge, InstallerPlanRequest } from '../shared/ipc.js';

const bridge: InstallerBridge = {
  getInitialState: () => ipcRenderer.invoke('installer:getInitialState'),
  getPlan: (request: InstallerPlanRequest) => ipcRenderer.invoke('installer:getPlan', request),
  start: (request) => ipcRenderer.invoke('installer:start', request),
  onProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload as Parameters<typeof callback>[0]);
    };
    ipcRenderer.on('installer:progress', listener);
    return () => ipcRenderer.removeListener('installer:progress', listener);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('installer', bridge);
