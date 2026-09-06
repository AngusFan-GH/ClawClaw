/**
 * Vitest Test Setup
 * Renderer tests run in jsdom; backend core tests run in node (per-file
 * `@vitest-environment node`). Only install the renderer bridge when a DOM
 * exists so node-environment tests are unaffected.
 */
import { vi } from 'vitest';

if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest').catch(() => undefined);

  const mockDesktop = {
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
    },
    openExternal: vi.fn(),
    platform: 'darwin',
    isDev: true,
  };

  Object.defineProperty(window, 'desktop', { value: mockDesktop, writable: true, configurable: true });

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});
