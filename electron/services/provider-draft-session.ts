import { getClawXProviderStore } from './providers/store-instance';

type ProviderDraftEntry = {
  present: boolean;
  value?: unknown;
};

type ProviderDraftState = {
  snapshot: Record<string, ProviderDraftEntry>;
};

const PROVIDER_DRAFT_KEYS = [
  'schemaVersion',
  'providers',
  'providerAccounts',
  'apiKeys',
  'providerSecrets',
  'defaultProvider',
  'defaultProviderAccountId',
] as const;

let activeDraftState: ProviderDraftState | null = null;

function cloneJsonValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

export async function beginProviderDraftSession(): Promise<void> {
  if (activeDraftState) {
    return;
  }

  const store = await getClawXProviderStore();
  const snapshot = Object.fromEntries(
    PROVIDER_DRAFT_KEYS.map((key) => {
      const value = store.get(key);
      return [key, {
        present: value !== undefined,
        value: cloneJsonValue(value),
      } satisfies ProviderDraftEntry];
    }),
  );

  activeDraftState = { snapshot };
}

export async function discardProviderDraftSession(): Promise<void> {
  const draft = activeDraftState;
  if (!draft) {
    return;
  }

  const store = await getClawXProviderStore();
  for (const key of PROVIDER_DRAFT_KEYS) {
    const entry = draft.snapshot[key];
    if (entry?.present) {
      store.set(key, cloneJsonValue(entry.value));
    } else {
      store.delete(key);
    }
  }

  await clearProviderDraftSession();
}

export async function clearProviderDraftSession(): Promise<void> {
  if (!activeDraftState) {
    return;
  }

  activeDraftState = null;
}
