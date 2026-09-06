import { vi } from 'vitest';

/**
 * Lightweight window/desktop bridge for renderer unit tests that run in the
 * node environment (jsdom worker startup is slow on some filesystems).
 * Components that need a real DOM use the default jsdom environment instead.
 */

const invoke = vi.fn();
const on = vi.fn().mockReturnValue(() => undefined);
const off = vi.fn();
const once = vi.fn();

const desktop = {
  ipcRenderer: { invoke, on, off, once },
  openExternal: vi.fn(),
  platform: 'linux',
  isDev: true,
};

(globalThis as unknown as { window: unknown }).window = {
  desktop,
  matchMedia: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
};

export const mockBridge = { invoke, on, off, once };
