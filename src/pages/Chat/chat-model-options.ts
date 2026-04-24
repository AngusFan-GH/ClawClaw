import i18n from '@/i18n';
import {
  isMultiInstanceProviderType,
  PROVIDER_TYPE_INFO,
  type ProviderAccount,
  type ProviderVendorInfo,
} from '@/lib/providers';
import type { ChatToolbarModelOption } from './ChatToolbar';

export type ProviderCatalogModelOption = {
  id: string;
  name: string;
};

export type ProviderCatalogResponse = {
  runtimeProviderId?: string;
  models: ProviderCatalogModelOption[];
  resolved?: boolean;
  source?: 'runtime' | 'models_json_fallback' | 'direct';
};

export function getRuntimeProviderFallbackKey(account: ProviderAccount): string | undefined {
  if (account.vendorId === 'google' && account.authMode === 'oauth_browser') {
    return 'google-gemini-cli';
  }
  if (
    account.vendorId === 'openai'
    && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device')
  ) {
    return 'openai-codex';
  }
  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  if (isMultiInstanceProviderType(account.vendorId)) {
    return undefined;
  }
  return account.vendorId;
}

export function normalizeAccountModel(account: ProviderAccount, model?: string): string | undefined {
  if (
    account.vendorId === 'openai'
    && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device')
    && (model === 'gpt-5.2' || model === 'gpt-5.3-codex')
  ) {
    return 'gpt-5.4';
  }
  return model;
}

export function resolveAccountModelLabel(
  account: ProviderAccount,
  vendor: ProviderVendorInfo | undefined,
  runtimeProviderId?: string,
): { modelRef?: string; modelName?: string } {
  const runtimeProviderKey = runtimeProviderId || getRuntimeProviderFallbackKey(account);
  const fallbackVendor = PROVIDER_TYPE_INFO.find((item) => item.id === account.vendorId);
  const rawModel = normalizeAccountModel(
    account,
    account.model || vendor?.defaultModelId || fallbackVendor?.defaultModelId,
  );

  if (!rawModel) {
    return {
      modelName: vendor?.model || fallbackVendor?.model || account.label,
    };
  }

  return {
    modelRef: runtimeProviderKey
      ? (rawModel.startsWith(`${runtimeProviderKey}/`) ? rawModel : `${runtimeProviderKey}/${rawModel}`)
      : rawModel,
    modelName: rawModel.split('/').pop() || rawModel,
  };
}

export function resolveAccountModelOptions(
  account: ProviderAccount,
  vendor: ProviderVendorInfo | undefined,
  providerDisplayName: string,
  runtimeProviderId?: string,
): ChatToolbarModelOption[] {
  const runtimeProviderKey = runtimeProviderId || getRuntimeProviderFallbackKey(account);
  const fallbackVendor = PROVIDER_TYPE_INFO.find((item) => item.id === account.vendorId);
  const primaryModel = normalizeAccountModel(
    account,
    account.model || vendor?.defaultModelId || fallbackVendor?.defaultModelId,
  );
  const candidates = [primaryModel, ...(account.fallbackModels ?? [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const seen = new Set<string>();

  return candidates.flatMap((candidate) => {
    const normalizedRef = runtimeProviderKey
      ? (candidate.startsWith(`${runtimeProviderKey}/`) ? candidate : `${runtimeProviderKey}/${candidate}`)
      : candidate;
    if (seen.has(normalizedRef)) {
      return [];
    }
    seen.add(normalizedRef);
    const modelName = normalizedRef.split('/').pop() || normalizedRef;
    return [{
      value: normalizedRef,
      label: `${providerDisplayName} · ${modelName}`,
      shortLabel: modelName,
    }];
  });
}

export function isMultiInstanceRuntimeVendor(vendorId: ProviderAccount['vendorId']): boolean {
  return isMultiInstanceProviderType(vendorId);
}

export function isLocalModelProviderAccount(account: Pick<ProviderAccount, 'vendorId' | 'metadata'>): boolean {
  return account.vendorId === 'local-model' && account.metadata?.localModelProvider === true;
}

export function getProviderDisplayName(account: ProviderAccount, vendor?: ProviderVendorInfo): string {
  if (
    account.vendorId === 'local-model'
    || account.metadata?.localModel
    || account.metadata?.managedBy === 'preset-local-model'
  ) {
    return i18n.t('chat:composer.localModelProvider', '本地模型');
  }
  return account.label || vendor?.name || account.vendorId;
}

export function isStrictRuntimeCatalogAccount(account: ProviderAccount): boolean {
  return (
    (account.vendorId === 'openai' && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device'))
    || (account.vendorId === 'google' && account.authMode === 'oauth_browser')
  );
}

export function resolveAccountCatalogModelOptions(
  account: ProviderAccount,
  providerDisplayName: string,
  catalog: ProviderCatalogResponse | undefined,
): ChatToolbarModelOption[] {
  const runtimeProviderKey = catalog?.runtimeProviderId || getRuntimeProviderFallbackKey(account);
  const seen = new Set<string>();
  const models = catalog?.models ?? [];

  return models.flatMap((candidate) => {
    const normalizedId = normalizeAccountModel(account, candidate.id)?.trim();
    if (!normalizedId) {
      return [];
    }

    const normalizedRef = runtimeProviderKey
      ? (normalizedId.startsWith(`${runtimeProviderKey}/`) ? normalizedId : `${runtimeProviderKey}/${normalizedId}`)
      : normalizedId;
    if (seen.has(normalizedRef)) {
      return [];
    }
    seen.add(normalizedRef);

    const displayName = candidate.name?.trim() || normalizedId.split('/').pop() || normalizedId;
    return [{
      value: normalizedRef,
      label: `${providerDisplayName} · ${displayName}`,
      shortLabel: displayName,
    }];
  });
}

export function normalizeSessionModelValue(
  session: { model?: string; modelProvider?: string } | undefined,
  options: ChatToolbarModelOption[],
): string | undefined {
  const currentModel = session?.model?.trim();
  if (!currentModel) return undefined;
  const exact = options.find((option) => option.value === currentModel);
  if (exact) return exact.value;

  const provider = session?.modelProvider?.trim();
  if (provider && !currentModel.includes('/')) {
    const withProvider = `${provider}/${currentModel}`;
    const byProvider = options.find((option) => option.value === withProvider);
    if (byProvider) return byProvider.value;
  }

  const suffixMatches = options.filter((option) => option.value.split('/').pop() === currentModel);
  if (suffixMatches.length === 1) {
    return suffixMatches[0].value;
  }

  return undefined;
}

export function normalizeModelRefValue(
  modelRef: string | undefined,
  options: ChatToolbarModelOption[],
): string | undefined {
  if (!modelRef?.trim()) return undefined;
  return normalizeSessionModelValue({ model: modelRef }, options);
}

export function dedupeModelOptions(options: ChatToolbarModelOption[]): ChatToolbarModelOption[] {
  const seenValues = new Set<string>();

  return options.filter((option) => {
    const valueKey = option.value.trim().toLowerCase();
    if (seenValues.has(valueKey)) {
      return false;
    }
    seenValues.add(valueKey);
    return true;
  });
}
