/**
 * The single renderer→core boundary. There is no HTTP proxy, no host-api
 * shim and no gateway RPC: every call is an explicit, allowlisted IPC channel
 * handled in backend/core/main.ts.
 */

export class IpcError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'IpcError';
  }
}

/** Backend serializes errors as `CODE: human message`. */
export function parseError(error: unknown): IpcError {
  if (error instanceof IpcError) return error;
  const raw = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z_]+):\s?([\s\S]*)$/.exec(raw);
  return match ? new IpcError(match[1], match[2] || match[1]) : new IpcError('INTERNAL_ERROR', raw);
}

export async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await window.desktop.ipcRenderer.invoke<T>(channel, ...args);
  } catch (error) {
    throw parseError(error);
  }
}

export function onEvent(channel: string, callback: (...args: unknown[]) => void): () => void {
  return window.desktop.ipcRenderer.on(channel, callback);
}

export function openExternal(url: string): void {
  if (/^https?:\/\//i.test(url)) void window.desktop.openExternal(url);
}
