/** Minimal desktop bridge surface provided by src/lib/desktop.ts. */
export {};

declare global {
  interface Window {
    desktop: {
      platform: NodeJS.Platform | string;
      isDev: boolean;
      openExternal(url: string): Promise<void>;
      ipcRenderer: {
        invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
        on(channel: string, callback: (...args: unknown[]) => void): () => void;
        once(channel: string, callback: (...args: unknown[]) => void): void;
        off(channel: string, callback?: (...args: unknown[]) => void): void;
      };
    };
  }
}
