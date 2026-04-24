import { getDataDir } from '../../utils/paths';

// Lazy-load electron-store (ESM module) from the main process only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let providerStore: any = null;

export async function getClawXProviderStore() {
  if (!providerStore) {
    const Store = (await import('electron-store')).default;
    providerStore = new Store({
      name: 'clawclaw-providers',
      // Keep provider accounts and secrets on the portable drive when the app
      // runs from a USB unpacked build.
      cwd: getDataDir(),
      defaults: {
        schemaVersion: 0,
        providers: {} as Record<string, unknown>,
        providerAccounts: {} as Record<string, unknown>,
        apiKeys: {} as Record<string, string>,
        providerSecrets: {} as Record<string, unknown>,
        defaultProvider: null as string | null,
        defaultProviderAccountId: null as string | null,
      },
    });
  }

  return providerStore;
}
