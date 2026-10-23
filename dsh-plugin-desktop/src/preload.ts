/** Minimal context-isolated bridge for resolving operating-system drag payloads. */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { DESKTOP_LOCALE_READ_CHANNEL } from './compatibility-chrome-contract.ts'
import { DESKTOP_FILE_PATH_BRIDGE } from './file-path-bridge-contract.ts'

// Upstream client plugins use this inert marker to distinguish the native
// shell from a browser before any Cordis client module is activated.
contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1 })

contextBridge.exposeInMainWorld(DESKTOP_FILE_PATH_BRIDGE, {
  /** Resolve only genuine disk-backed Web File objects selected by the operator. */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
})

// Use DSH's supported bootstrap hook so Windows Chromium's locale does not
// override the OS language order. Durable changes remain owned by Host settings.
if (process.platform === 'win32' || process.platform === 'darwin') contextBridge.exposeInMainWorld('__DSH_LOCALE__', {
  read: () => ipcRenderer.invoke(DESKTOP_LOCALE_READ_CHANNEL),
  onChange: (_locale: string) => {},
})
