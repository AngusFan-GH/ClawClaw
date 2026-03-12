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
    resolve(process.resourcesPath, 'config', 'local-model-presets.json'),
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
  const legacyAccounts = accounts.filter((account) => account.vendorId === 'local-model');

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
    await syncDeletedProviderToRuntime(previousConfig, account.id, gatewayManager);
    await syncUpdatedProviderToRuntime(providerAccountToConfig(nextAccount), undefined, gatewayManager);
  }
}

export async function ensurePresetLocalModelsApplied(gatewayManager?: GatewayManager): Promise<void> {
  const presets = await readLocalModelPresets();
  if (presets.length === 0) {
    return;
  }

  const providerService = getProviderService();
  const vendors = await providerService.listVendors();
  const accounts = await providerService.listAccounts();
  const presetAccounts = accounts.filter(
    (account) => account.vendorId === 'custom' && account.metadata?.managedBy === PRESET_MANAGED_BY,
  );

  let defaultAccountId: string | null = null;

  for (const [index, preset] of presets.entries()) {
    const existing = presetAccounts.find((account) => account.metadata?.presetId === preset.id);
    const now = new Date().toISOString();

    if (existing) {
      const updated = await providerService.updateAccount(
        existing.id,
        {
          label: preset.name,
          authMode: 'local',
          baseUrl: preset.baseUrl,
          apiProtocol: preset.apiProtocol || 'openai-completions',
          model: preset.modelId,
          enabled: true,
          metadata: {
            ...existing.metadata,
            presetId: preset.id,
            managedBy: PRESET_MANAGED_BY,
          },
          updatedAt: now,
        },
        resolveProviderApiKeyForSave('custom', preset.apiKey ?? '') as string,
      );
      await syncUpdatedProviderToRuntime(providerAccountToConfig(updated), undefined, gatewayManager);
      if (index === 0) {
        defaultAccountId = updated.id;
      }
      continue;
    }

    const accountId = buildRuntimeProviderAccountId('custom', null, vendors);
      const created = await providerService.createAccount(
        {
        id: accountId,
        vendorId: 'custom',
        label: preset.name,
        authMode: 'local',
        baseUrl: preset.baseUrl,
        apiProtocol: preset.apiProtocol || 'openai-completions',
        model: preset.modelId,
        enabled: true,
        isDefault: false,
        metadata: {
          presetId: preset.id,
          managedBy: PRESET_MANAGED_BY,
        },
        createdAt: now,
          updatedAt: now,
        },
        resolveProviderApiKeyForSave('custom', preset.apiKey ?? '') as string,
      );
    await syncSavedProviderToRuntime(providerAccountToConfig(created), undefined, gatewayManager);
    if (index === 0) {
      defaultAccountId = created.id;
    }
  }

  if (defaultAccountId) {
    await providerService.setDefaultAccount(defaultAccountId);
    await syncDefaultProviderToRuntime(defaultAccountId, gatewayManager);
  }
}
