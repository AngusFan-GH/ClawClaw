import { getDataDir } from '../../utils/paths';

// Lazily load the JSON settings store from the backend process only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let providerStore: any = null;

export async function getClawXProviderStore() {
  if (!providerStore) {
    const Store = (await import('../../host/json-store')).default;
    providerStore = new Store({
      name: 'clawclaw-providers',
      cwd: getDataDir(),
      defaults: {
        schemaVersion: 0,
        providers: {} as Record<string, unknown>,
        providerAccounts: {} as Record<string, unknown>,
        apiKeys: {} as Record<string, string>,
        providerSecrets: {} as Record<string, unknown>,
      },
    });
  }

  return providerStore;
}
