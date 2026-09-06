import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

type Listener = (...args: unknown[]) => void;
const listeners = new Map<string, Set<Listener>>();
export async function initializeDesktop(): Promise<void> {
  await listen<{ channel: string; args: unknown[] }>('host-event', ({ payload }) => {
    for (const callback of listeners.get(payload.channel) || []) {
      try { callback(...payload.args); } catch (error) { console.error('Host event listener failed', error); }
    }
  });
  const platform = await invoke<NodeJS.Platform>('host_platform');
  window.desktop = {
    platform,
    isDev: import.meta.env.DEV,
    openExternal: async url => { await invoke('host_request', { channel: 'shell:openExternal', args: [url] }); },
    ipcRenderer: {
      invoke: (channel, ...args) => invoke('host_request', { channel, args }),
      on(channel, callback) {
        if (!listeners.has(channel)) listeners.set(channel, new Set());
        listeners.get(channel)!.add(callback);
        return () => { listeners.get(channel)?.delete(callback); };
      },
      once(channel, callback) {
        const listener: Listener = (...args) => { listeners.get(channel)?.delete(listener); callback(...args); };
        this.on(channel, listener);
      },
      off(channel, callback) { if (callback) listeners.get(channel)?.delete(callback); else listeners.delete(channel); },
    },
  };
  document.addEventListener('mousedown', event => {
    const target = event.target as HTMLElement;
    if (event.button === 0 && target.closest('.drag-region') && !target.closest('.no-drag,button,input,a')) {
      void getCurrentWindow().startDragging();
    }
  });
  document.addEventListener('click', event => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (anchor && /^https?:\/\//i.test(anchor.href)) { event.preventDefault(); void window.desktop.openExternal(anchor.href); }
  });
}
