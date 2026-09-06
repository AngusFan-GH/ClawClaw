import { resourcesPath } from '../../host/desktop';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { GatewayManager } from '../../gateway/manager';
import { getProviderService } from './provider-service';
import { providerAccountToConfig } from './provider-store';
import {
  syncDefaultProviderToRuntime,
  syncDeletedProviderToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
} from './provider-runtime-sync';

export type LocalModelPreset = {
  id: string;
  name: string;
  description?: string;
  modelId: string;
  baseUrl: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  capabilities?: string[];
  apiKey?: string;
};

const PRESET_MANAGED_BY = 'preset-local-model' as const;
const LOCAL_PROVIDER_PLACEHOLDER_API_KEY = 'ollama-local';

function schedulePresetGatewayRefresh(
  gatewayManager: GatewayManager | undefined,
  mode: 'reload' | 'restart',
): void {
  if (!gatewayManager || gatewayManager.getStatus().state === 'stopped') {
    return;
  }
  if (mode === 'restart') {
    gatewayManager.debouncedRestart();
    return;
  }
  gatewayManager.debouncedReload();
}

function buildRuntimeProviderAccountId(
  vendorId: string,
  existingAccountId: string | null,
  vendors: Array<{ id: string; supportsMultipleAccounts?: boolean }>,
): string {
  if (existingAccountId) {
    return existingAccountId;
  }

  const vendor = vendors.find((candidate) => candidate.id === vendorId);
  return vendor?.supportsMultipleAccounts ? `${vendorId}-${crypto.randomUUID()}` : vendorId;
}

function resolveProviderApiKeyForSave(type: string, apiKey: string): string | undefined {
  const trimmed = apiKey.trim();
  if (type === 'ollama' || type === 'local-model' || type === 'custom') {
    return trimmed || LOCAL_PROVIDER_PLACEHOLDER_API_KEY;
  }
  return trimmed || undefined;
}

function resolvePresetFilePath(): string {
  const candidates = [
    resolve(process.cwd(), 'config', 'local-model-presets.json'),
    resolve(__dirname, '../../../config/local-model-presets.json'),
    resolve(resourcesPath, 'config', 'local-model-presets.json'),
  ];

  const matched = candidates.find((candidate) => existsSync(candidate));
  return matched ?? candidates[0];
}

export async function readLocalModelPresets(): Promise<LocalModelPreset[]> {
  const filePath = resolvePresetFilePath();
  const raw = await readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

export async function migrateLegacyLocalModelAccounts(gatewayManager?: GatewayManager): Promise<void> {
  const providerService = getProviderService();
  const accounts = await providerService.listAccounts();
  const legacyAccounts = accounts.filter((account) => (
    account.vendorId === 'local-model'
    && !account.metadata?.localModelProvider
    && !account.metadata?.localModel
  ));

  for (const account of legacyAccounts) {
    const previousConfig = providerAccountToConfig(account);
    const nextAccount = await providerService.updateAccount(
      account.id,
      {
        vendorId: 'custom',
        authMode: 'local',
        updatedAt: new Date().toISOString(),
      },
      resolveProviderApiKeyForSave('custom', '') as string,
    );
    await syncDeletedProviderToRuntime(previousConfig, account.id, undefined);
    await syncUpdatedProviderToRuntime(providerAccountToConfig(nextAccount), undefined, undefined);
  }

  if (legacyAccounts.length > 0) {
    schedulePresetGatewayRefresh(gatewayManager, 'reload');
  }
}

export async function cleanupOrphanLocalModelRuntimeAccounts(): Promise<{ removedAccountIds: string[] }> {
  const providerService = getProviderService();
  const accounts = await providerService.listAccounts();
  const hasLocalModelProvider = accounts.some((account) => (
    account.vendorId === 'local-model' && account.metadata?.localModelProvider === true
  ));

  if (hasLocalModelProvider) {
    return { removedAccountIds: [] };
  }

  const orphanAccounts = accounts.filter((account) => (
    account.vendorId === 'local-model' && account.metadata?.localModelProvider !== true
  ));

  for (const orphanAccount of orphanAccounts) {
    await providerService.deleteAccount(orphanAccount.id);
  }

  return { removedAccountIds: orphanAccounts.map((account) => account.id) };
}


export async function applyPresetLocalModelSelection(
  primaryPresetId: string,
  gatewayManager?: GatewayManager,
): Promise<{ accountId: string; primaryPresetId: string }> {
  const presets = await readLocalModelPresets();
  const primaryPreset = presets.find((preset) => preset.id === primaryPresetId);
  if (!primaryPreset) {
    throw new Error('Preset not found');
  }

  const orderedPresets = [primaryPreset, ...presets.filter((preset) => preset.id !== primaryPreset.id)];
  const fallbackModels = orderedPresets.slice(1).map((preset) => preset.modelId).filter(Boolean);

  const providerService = getProviderService();
  const vendors = await providerService.listVendors();
  const accounts = await providerService.listAccounts();
  const presetAccounts = accounts.filter(
    (account) => account.vendorId === 'custom' && account.metadata?.managedBy === PRESET_MANAGED_BY,
  );
  const preferredAccount = presetAccounts.find((account) => account.metadata?.presetId === primaryPreset.id);
  const targetAccount = preferredAccount ?? presetAccounts[0];
  const now = new Date().toISOString();

  const updatePatch = {
    label: primaryPreset.name,
    authMode: 'local' as const,
    baseUrl: primaryPreset.baseUrl,
    apiProtocol: primaryPreset.apiProtocol || 'openai-completions',
    model: primaryPreset.modelId,
    fallbackModels,
    enabled: true,
    metadata: {
      ...(targetAccount?.metadata ?? {}),
      presetId: primaryPreset.id,
      managedBy: PRESET_MANAGED_BY,
      primaryPresetId: primaryPreset.id,
      presetIds: orderedPresets.map((preset) => preset.id),
    },
    updatedAt: now,
  };

  const account = targetAccount
    ? await providerService.updateAccount(
      targetAccount.id,
      updatePatch,
      resolveProviderApiKeyForSave('custom', primaryPreset.apiKey ?? '') as string,
    )
    : await providerService.createAccount(
      {
        id: buildRuntimeProviderAccountId('custom', null, vendors),
        vendorId: 'custom',
        label: primaryPreset.name,
        authMode: 'local',
        baseUrl: primaryPreset.baseUrl,
        apiProtocol: primaryPreset.apiProtocol || 'openai-completions',
        model: primaryPreset.modelId,
        fallbackModels,
        enabled: true,
        isDefault: false,
        metadata: {
          presetId: primaryPreset.id,
          managedBy: PRESET_MANAGED_BY,
          primaryPresetId: primaryPreset.id,
          presetIds: orderedPresets.map((preset) => preset.id),
        },
        createdAt: now,
        updatedAt: now,
      },
      resolveProviderApiKeyForSave('custom', primaryPreset.apiKey ?? '') as string,
    );

  if (targetAccount) {
    await syncUpdatedProviderToRuntime(providerAccountToConfig(account), undefined, undefined);
  } else {
    await syncSavedProviderToRuntime(providerAccountToConfig(account), undefined, undefined);
  }

  for (const staleAccount of presetAccounts) {
    if (staleAccount.id === account.id) continue;
    await providerService.deleteAccount(staleAccount.id);
    await syncDeletedProviderToRuntime(providerAccountToConfig(staleAccount), staleAccount.id, undefined);
  }

  await providerService.setDefaultAccount(account.id);
  await syncDefaultProviderToRuntime(account.id, undefined);
  schedulePresetGatewayRefresh(gatewayManager, 'reload');

  return { accountId: account.id, primaryPresetId: primaryPreset.id };
}
