import type { ChatToolbarModelOption } from './ChatToolbar';
import { PROVIDER_TYPE_INFO } from '@/lib/providers';

export type ChatModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  alias?: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<'text' | 'image' | 'document'>;
};

function buildQualifiedChatModelValue(model: string, provider?: string | null): string {
  const trimmedModel = model.trim();
  if (!trimmedModel) return '';
  const trimmedProvider = provider?.trim();
  if (!trimmedProvider) return trimmedModel;
  const providerPrefix = `${trimmedProvider.toLowerCase()}/`;
  return trimmedModel.toLowerCase().startsWith(providerPrefix)
    ? trimmedModel
    : `${trimmedProvider}/${trimmedModel}`;
}

function formatRawCatalogLabel(
  entry: ChatModelCatalogEntry,
  providerDisplayOverrides?: ReadonlyMap<string, string>,
): string {
  const provider = resolveProviderDisplayName(entry.provider, providerDisplayOverrides);
  return provider ? `${entry.id} · ${provider}` : entry.id;
}

function resolveCatalogDisplayName(entry: ChatModelCatalogEntry): string {
  return entry.alias?.trim() || entry.name.trim() || entry.id.trim();
}

function createQualifiedCatalogKey(entry: ChatModelCatalogEntry): string {
  return buildQualifiedChatModelValue(entry.id, entry.provider).trim().toLowerCase();
}

function createNameProviderKey(name: string, provider?: string | null): string {
  return `${name.toLowerCase()}\u0000${provider?.trim().toLowerCase() ?? ''}`;
}

function resolveProviderDisplayName(
  provider?: string | null,
  providerDisplayOverrides?: ReadonlyMap<string, string>,
): string | undefined {
  const trimmed = provider?.trim();
  if (!trimmed) return undefined;
  const override = providerDisplayOverrides?.get(trimmed);
  if (override?.trim()) {
    return override.trim();
  }

  const runtimeAliasMap: Record<string, string> = {
    'openai-codex': 'openai',
    'google-gemini-cli': 'google',
  };
  const normalizedId = runtimeAliasMap[trimmed] ?? trimmed;
  const builtin = PROVIDER_TYPE_INFO.find((entry) => entry.id === normalizedId);
  if (builtin?.name) {
    return builtin.name;
  }
  if (normalizedId.startsWith('custom-') || normalizedId.startsWith('custom/')) {
    return 'Custom';
  }
  if (normalizedId.startsWith('local-model')) {
    return 'Local Model';
  }
  if (normalizedId.startsWith('ollama')) {
    return 'Ollama';
  }
  if (normalizedId.startsWith('vllm')) {
    return 'vLLM';
  }
  if (normalizedId.startsWith('sglang')) {
    return 'SGLang';
  }
  return trimmed;
}

export function buildCatalogDisplayLookup(
  catalog: ChatModelCatalogEntry[],
  providerDisplayOverrides?: ReadonlyMap<string, string>,
): Map<string, string> {
  const nameToValues = new Map<string, Set<string>>();
  const nameProviderToValues = new Map<string, Set<string>>();

  for (const entry of catalog) {
    const name = resolveCatalogDisplayName(entry);
    if (!name) continue;

    const qualifiedKey = createQualifiedCatalogKey(entry);
    const normalizedName = name.toLowerCase();
    const providerKey = createNameProviderKey(name, entry.provider);

    const nameValues = nameToValues.get(normalizedName) ?? new Set<string>();
    nameValues.add(qualifiedKey);
    nameToValues.set(normalizedName, nameValues);

    const nameProviderValues = nameProviderToValues.get(providerKey) ?? new Set<string>();
    nameProviderValues.add(qualifiedKey);
    nameProviderToValues.set(providerKey, nameProviderValues);
  }

  const displayLookup = new Map<string, string>();
  for (const entry of catalog) {
    const qualifiedKey = createQualifiedCatalogKey(entry);
    const name = resolveCatalogDisplayName(entry);
    const providerDisplayName = resolveProviderDisplayName(entry.provider, providerDisplayOverrides);
    if (!name) {
      displayLookup.set(qualifiedKey, formatRawCatalogLabel(entry, providerDisplayOverrides));
      continue;
    }

    const normalizedName = name.toLowerCase();
    if ((nameToValues.get(normalizedName)?.size ?? 0) <= 1) {
      displayLookup.set(qualifiedKey, providerDisplayName ? `${name} · ${providerDisplayName}` : name);
      continue;
    }

    const provider = entry.provider?.trim();
    if ((nameProviderToValues.get(createNameProviderKey(name, provider))?.size ?? 0) <= 1) {
      displayLookup.set(
        qualifiedKey,
        providerDisplayName ? `${name} · ${providerDisplayName}` : `${name} · ${entry.id}`,
      );
      continue;
    }

      displayLookup.set(
        qualifiedKey,
        providerDisplayName ? `${entry.id} · ${providerDisplayName}` : `${name} · ${formatRawCatalogLabel(entry)}`,
      );
  }

  return displayLookup;
}

export function buildChatCatalogModelOptions(
  catalog: ChatModelCatalogEntry[],
  providerDisplayOverrides?: ReadonlyMap<string, string>,
): ChatToolbarModelOption[] {
  const displayLookup = buildCatalogDisplayLookup(catalog, providerDisplayOverrides);
  const seen = new Set<string>();

  return catalog.flatMap((entry) => {
    const provider = entry.provider?.trim();
    const value = buildQualifiedChatModelValue(entry.id, provider);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{
      value,
      label: displayLookup.get(key) ?? formatRawCatalogLabel(entry),
      shortLabel: resolveCatalogDisplayName(entry),
    }];
  });
}
