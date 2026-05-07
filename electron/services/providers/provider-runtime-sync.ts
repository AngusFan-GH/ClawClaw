import type { GatewayManager } from '../../gateway/manager';
import type { RuntimeApplyRequirement } from '../../../src/shared/runtime-apply';
import { getProviderAccount, listProviderAccounts } from './provider-store';
import { providerAccountToConfig } from './provider-store';
import { getProviderSecret } from '../secrets/secret-store';
import type { ProviderConfig } from '../../utils/secure-storage';
import { getAllProviders, getApiKey, getDefaultProvider, getProvider } from '../../utils/secure-storage';
import { getProviderConfig, getProviderDefaultModel } from '../../utils/provider-registry';
import {
  getActiveOpenClawProviders,
  removeProviderFromOpenClaw,
  saveOAuthTokenToOpenClaw,
  saveProviderKeyToOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw,
  updateAgentModelProvider,
} from '../../utils/openclaw-auth';
import { updateOpenClawConfigRecord } from '../../utils/openclaw-config';
import { getOpenClawProviderKeyForType } from '../../utils/provider-keys';
import { logger } from '../../utils/logger';
import {
  isMultiInstanceProviderType,
  isSelfHostedProviderType,
} from '../../shared/providers/types';

const GOOGLE_OAUTH_RUNTIME_PROVIDER = 'google-gemini-cli';
const GOOGLE_OAUTH_DEFAULT_MODEL_REF = `${GOOGLE_OAUTH_RUNTIME_PROVIDER}/gemini-3-pro-preview`;
const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';
const OPENAI_OAUTH_DEFAULT_MODEL_REF = `${OPENAI_OAUTH_RUNTIME_PROVIDER}/gpt-5.4`;

function normalizeOpenAIOAuthModel(model?: string): string | undefined {
  if (!model) {
    return undefined;
  }

  const normalized = model.trim();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === 'gpt-5.2'
    || normalized === `${OPENAI_OAUTH_RUNTIME_PROVIDER}/gpt-5.2`
    || normalized === 'gpt-5.3-codex'
    || normalized === `${OPENAI_OAUTH_RUNTIME_PROVIDER}/gpt-5.3-codex`
  ) {
    return 'gpt-5.4';
  }

  return normalized.startsWith(`${OPENAI_OAUTH_RUNTIME_PROVIDER}/`)
    ? normalized.slice(OPENAI_OAUTH_RUNTIME_PROVIDER.length + 1)
    : normalized;
}

function isLocalModelProviderConfigAccount(account: {
  vendorId: string;
  metadata?: { localModelProvider?: boolean };
}): boolean {
  return account.vendorId === 'local-model' && account.metadata?.localModelProvider === true;
}

function shouldReconcileRuntimeProviderKey(providerKey: string): boolean {
  return (
    providerKey.startsWith('custom-')
    || providerKey.startsWith('local-model-')
    || providerKey.startsWith('ollama-')
    || providerKey.startsWith('vllm-')
    || providerKey.startsWith('sglang-')
  );
}

type RuntimeProviderSyncContext = {
  runtimeProviderKey: string;
  meta: ReturnType<typeof getProviderConfig>;
  api: string;
  disableTools: boolean;
  allowPrivateNetwork: boolean;
};

export type GatewayRefreshMode = 'reload' | 'restart';

type GatewayRefreshRequest = {
  source?: string;
  reason?: string;
  mode?: GatewayRefreshMode;
  delayMs?: number;
  onlyIfRunning?: boolean;
  message: string;
};

let gatewayRefreshScheduler: ((request: GatewayRefreshRequest) => void) | null = null;

export function resolveProviderGatewayRefreshMode(
  config: ProviderConfig,
  runtimeProviderKey?: string,
): GatewayRefreshMode {
  // Mirror OpenClaw's gateway reload plan:
  // - `models.*` and `agents.defaults.model` are hot-reloadable
  // - `plugins.*` requires a full gateway restart
  //
  // Our provider sync writes `plugins.entries.*` only for the OAuth plugin-backed
  // portal providers. Everything else should stay on reload so model/provider
  // edits do not force unnecessary restarts.
  if (
    config.type === 'qwen-portal'
    || config.type === 'minimax-portal'
    || config.type === 'minimax-portal-cn'
    || runtimeProviderKey === 'qwen-portal'
    || runtimeProviderKey === 'minimax-portal'
  ) {
    return 'restart';
  }

  return 'reload';
}

export function resolveProviderRuntimeApplyRequirement(
  config: ProviderConfig,
  runtimeProviderKey?: string,
): RuntimeApplyRequirement {
  return resolveProviderGatewayRefreshMode(config, runtimeProviderKey) === 'restart'
    ? 'restart'
    : 'reload';
}

function buildAgentProviderModels(
  providerType: string,
  modelIds: string[],
  disableTools = false,
): Array<Record<string, unknown> & { id: string; name: string }> {
  return modelIds.map((id) => ({
    id,
    name: id,
    ...(providerType === 'vllm' && disableTools ? { compat: { supportsTools: false } } : {}),
  }));
}

function normalizeProviderBaseUrl(config: ProviderConfig, baseUrl?: string): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  if (config.type === 'minimax-portal' || config.type === 'minimax-portal-cn') {
    return baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
  }

  return baseUrl;
}

function shouldUseExplicitDefaultOverride(config: ProviderConfig, runtimeProviderKey: string): boolean {
  return Boolean(config.baseUrl || config.apiProtocol || runtimeProviderKey !== config.type);
}

export function getOpenClawProviderKey(type: string, providerId: string): string {
  return getOpenClawProviderKeyForType(type, providerId);
}

function getLegacyOpenClawProviderKey(type: string, providerId: string): string {
  if (type === 'local-model') {
    const normalizedId = providerId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'default';
    return `local-model-${normalizedId}`;
  }
  if (isMultiInstanceProviderType(type)) {
    const suffix = providerId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'default';
    return `${type}-${suffix}`;
  }
  if (type === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  return type;
}

async function resolveRuntimeProviderKey(config: ProviderConfig): Promise<string> {
  const account = await getProviderAccount(config.id);
  if (config.type === 'google' && account?.authMode === 'oauth_browser') {
    return GOOGLE_OAUTH_RUNTIME_PROVIDER;
  }
  if (
    config.type === 'openai'
    && (account?.authMode === 'oauth_browser' || account?.authMode === 'oauth_device')
  ) {
    return OPENAI_OAUTH_RUNTIME_PROVIDER;
  }
  return getOpenClawProviderKey(config.type, config.id);
}

async function removeLegacyLocalModelAliases(config: ProviderConfig): Promise<void> {
  if (config.type !== 'local-model') {
    return;
  }

  const normalizedId = config.id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'default';
  const legacyCustomAlias = `custom-${normalizedId}`;
  const legacyLocalModelAlias = `local-model-${normalizedId}`;
  await removeProviderFromOpenClaw(legacyCustomAlias);
  await removeProviderFromOpenClaw(legacyLocalModelAlias);
}

async function buildAccountPrimaryModelRef(account: Awaited<ReturnType<typeof listProviderAccounts>>[number]): Promise<string | undefined> {
  if (isLocalModelProviderConfigAccount(account) || !account.enabled) {
    return undefined;
  }

  const runtimeProviderKey = await resolveRuntimeProviderKey({
    ...providerAccountToConfig(account),
    id: account.id,
  });

  const rawModel = account.vendorId === 'openai'
    && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device')
      ? normalizeOpenAIOAuthModel(account.model)
      : (account.model?.trim() || getProviderDefaultModel(account.vendorId));

  if (!rawModel) {
    return undefined;
  }

  return rawModel.startsWith(`${runtimeProviderKey}/`)
    ? rawModel
    : `${runtimeProviderKey}/${rawModel}`;
}

async function rebuildOpenClawModelAllowlistFromAccounts(): Promise<void> {
  const accounts = await listProviderAccounts();
  const activeAccounts = accounts.filter((account) => account.enabled && !isLocalModelProviderConfigAccount(account));
  const accountMap = new Map(activeAccounts.map((account) => [account.id, account]));
  const allowlist: Record<string, Record<string, never>> = {};

  for (const account of activeAccounts) {
    const primaryRef = await buildAccountPrimaryModelRef(account);
    if (primaryRef) {
      allowlist[primaryRef] = {};
    }

    const runtimeProviderKey = await resolveRuntimeProviderKey({
      ...providerAccountToConfig(account),
      id: account.id,
    });
    for (const fallback of account.fallbackModels ?? []) {
      const normalized = fallback.trim();
      if (!normalized) continue;
      const ref = normalized.startsWith(`${runtimeProviderKey}/`)
        ? normalized
        : `${runtimeProviderKey}/${normalized}`;
      allowlist[ref] = {};
    }

    for (const fallbackAccountId of account.fallbackAccountIds ?? []) {
      const fallbackAccount = accountMap.get(fallbackAccountId);
      if (!fallbackAccount) continue;
      const fallbackRef = await buildAccountPrimaryModelRef(fallbackAccount);
      if (fallbackRef) {
        allowlist[fallbackRef] = {};
      }
    }
  }

  await updateOpenClawConfigRecord((config) => {
    const agents = (config.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    defaults.models = allowlist;
    agents.defaults = defaults;
    config.agents = agents;
  });
}

async function reconcileRuntimeProvidersFromAccounts(): Promise<void> {
  const accounts = await listProviderAccounts();
  const desiredRuntimeKeys = new Set<string>();

  for (const account of accounts) {
    if (!account.enabled || isLocalModelProviderConfigAccount(account)) {
      continue;
    }
    desiredRuntimeKeys.add(
      await resolveRuntimeProviderKey({
        ...providerAccountToConfig(account),
        id: account.id,
      }),
    );
  }

  const activeProviders = await getActiveOpenClawProviders();
  for (const activeKey of activeProviders) {
    if (!shouldReconcileRuntimeProviderKey(activeKey)) {
      continue;
    }
    if (desiredRuntimeKeys.has(activeKey)) {
      continue;
    }
    await removeProviderFromOpenClaw(activeKey);
  }
}

async function isGoogleBrowserOAuthProvider(config: ProviderConfig): Promise<boolean> {
  const account = await getProviderAccount(config.id);
  if (config.type !== 'google' || account?.authMode !== 'oauth_browser') {
    return false;
  }

  const secret = await getProviderSecret(config.id);
  return secret?.type === 'oauth';
}

async function isOpenAIOAuthProvider(config: ProviderConfig): Promise<boolean> {
  const account = await getProviderAccount(config.id);
  if (
    config.type !== 'openai'
    || (account?.authMode !== 'oauth_browser' && account?.authMode !== 'oauth_device')
  ) {
    return false;
  }

  const secret = await getProviderSecret(config.id);
  return secret?.type === 'oauth';
}

export function getProviderModelRef(config: ProviderConfig): string | undefined {
  const providerKey = getOpenClawProviderKey(config.type, config.id);

  if (config.model) {
    return config.model.startsWith(`${providerKey}/`)
      ? config.model
      : `${providerKey}/${config.model}`;
  }

  const defaultModel = getProviderDefaultModel(config.type);
  if (!defaultModel) {
    return undefined;
  }

  return defaultModel.startsWith(`${providerKey}/`)
    ? defaultModel
    : `${providerKey}/${defaultModel}`;
}

export async function getProviderFallbackModelRefs(config: ProviderConfig): Promise<string[]> {
  const allProviders = await getAllProviders();
  const providerMap = new Map(allProviders.map((provider) => [provider.id, provider]));
  const seen = new Set<string>();
  const results: string[] = [];
  const providerKey = await resolveRuntimeProviderKey(config);

  for (const fallbackModel of config.fallbackModels ?? []) {
    const normalizedModel = fallbackModel.trim();
    if (!normalizedModel) continue;

    const modelRef = normalizedModel.startsWith(`${providerKey}/`)
      ? normalizedModel
      : `${providerKey}/${normalizedModel}`;

    if (seen.has(modelRef)) continue;
    seen.add(modelRef);
    results.push(modelRef);
  }

  for (const fallbackId of config.fallbackProviderIds ?? []) {
    if (!fallbackId || fallbackId === config.id) continue;

    const fallbackProvider = providerMap.get(fallbackId);
    if (!fallbackProvider) continue;

    const fallbackProviderKey = await resolveRuntimeProviderKey(fallbackProvider);
    const fallbackModel = fallbackProvider.model || getProviderDefaultModel(fallbackProvider.type);
    const modelRef = fallbackModel
      ? (fallbackModel.startsWith(`${fallbackProviderKey}/`)
        ? fallbackModel
        : `${fallbackProviderKey}/${fallbackModel}`)
      : undefined;
    if (!modelRef || seen.has(modelRef)) continue;

    seen.add(modelRef);
    results.push(modelRef);
  }

  return results;
}

export function registerGatewayRefreshScheduler(
  scheduler: ((request: GatewayRefreshRequest) => void) | null,
): void {
  gatewayRefreshScheduler = scheduler;
}

function scheduleGatewayRefresh(
  gatewayManager: GatewayManager | undefined,
  message: string,
  options?: {
    delayMs?: number;
    onlyIfRunning?: boolean;
    mode?: GatewayRefreshMode;
    source?: string;
    reason?: string;
  },
): void {
  if (gatewayRefreshScheduler) {
    gatewayRefreshScheduler({
      source: options?.source ?? 'provider.runtimeSync',
      reason: options?.reason ?? 'provider.runtimeSync',
      mode: options?.mode,
      delayMs: options?.delayMs,
      onlyIfRunning: options?.onlyIfRunning,
      message,
    });
    return;
  }

  if (!gatewayManager) {
    return;
  }

  if (options?.onlyIfRunning && gatewayManager.getStatus().state === 'stopped') {
    return;
  }

  logger.info(message);
  if (options?.mode === 'restart') {
    gatewayManager.debouncedRestart(options?.delayMs);
    return;
  }
  gatewayManager.debouncedReload(options?.delayMs);
}

export async function syncProviderApiKeyToRuntime(
  providerType: string,
  providerId: string,
  apiKey: string,
): Promise<void> {
  const ock = getOpenClawProviderKey(providerType, providerId);
  await saveProviderKeyToOpenClaw(ock, apiKey);
}

export async function syncAllProviderAuthToRuntime(): Promise<void> {
  const accounts = await listProviderAccounts();

  for (const account of accounts) {
    const runtimeProviderKey = await resolveRuntimeProviderKey({
      id: account.id,
      name: account.label,
      type: account.vendorId,
      baseUrl: account.baseUrl,
      model: account.model,
      fallbackModels: account.fallbackModels,
      fallbackProviderIds: account.fallbackAccountIds,
      enabled: account.enabled,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    });

    const secret = await getProviderSecret(account.id);
    if (!secret) {
      continue;
    }

    if (secret.type === 'api_key') {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'local' && secret.apiKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'oauth') {
      await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
        access: secret.accessToken,
        refresh: secret.refreshToken,
        expires: secret.expiresAt,
        email: secret.email,
        projectId: secret.subject,
      });
    }
  }
}

export async function syncAllProvidersToRuntime(): Promise<void> {
  const accounts = await listProviderAccounts();

  for (const account of accounts) {
    if (!account.enabled || isLocalModelProviderConfigAccount(account)) {
      continue;
    }
    await syncProviderToRuntime(providerAccountToConfig(account), undefined);
  }

  await reconcileRuntimeProvidersFromAccounts();
  await rebuildOpenClawModelAllowlistFromAccounts();
}

async function syncProviderSecretToRuntime(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
): Promise<void> {
  const secret = await getProviderSecret(config.id);
  if (apiKey !== undefined) {
    const trimmedKey = apiKey.trim();
    if (trimmedKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, trimmedKey);
    }
    return;
  }

  if (secret?.type === 'api_key') {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
    return;
  }

  if (secret?.type === 'oauth') {
    await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
      access: secret.accessToken,
      refresh: secret.refreshToken,
      expires: secret.expiresAt,
      email: secret.email,
      projectId: secret.subject,
    });
    return;
  }

  if (secret?.type === 'local' && secret.apiKey) {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
  }
}

async function resolveRuntimeSyncContext(config: ProviderConfig): Promise<RuntimeProviderSyncContext | null> {
  const runtimeProviderKey = await resolveRuntimeProviderKey(config);
  const account = await getProviderAccount(config.id);
  const meta = getProviderConfig(config.type);
  const api = config.apiProtocol || (isSelfHostedProviderType(config.type) ? 'openai-completions' : meta?.api);
  if (!api) {
    return null;
  }

  return {
    runtimeProviderKey,
    meta,
    api,
    disableTools: config.type === 'vllm',
    allowPrivateNetwork: account?.metadata?.allowPrivateNetwork === true,
  };
}

async function syncRuntimeProviderConfig(
  config: ProviderConfig,
  context: RuntimeProviderSyncContext,
): Promise<void> {
  if (config.type === 'openai' && context.runtimeProviderKey === OPENAI_OAUTH_RUNTIME_PROVIDER) {
    return;
  }

  await syncProviderConfigToOpenClaw(context.runtimeProviderKey, config.model, {
    baseUrl: normalizeProviderBaseUrl(config, config.baseUrl || context.meta?.baseUrl),
    api: context.api,
    apiKeyEnv: context.meta?.apiKeyEnv,
    headers: context.meta?.headers,
    disableTools: context.disableTools,
    allowPrivateNetwork: context.allowPrivateNetwork,
  });
}

async function syncCustomProviderAgentModel(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
  disableTools: boolean,
): Promise<void> {
  if (!isSelfHostedProviderType(config.type) || config.type === 'ollama') {
    return;
  }

  const resolvedKey = apiKey !== undefined ? (apiKey.trim() || null) : await getApiKey(config.id);
  if (!config.baseUrl) {
    return;
  }

  const modelIds = config.type === 'local-model'
    ? Array.from(new Set(
      (await listProviderAccounts())
        .filter((account) => account.enabled && account.vendorId === 'local-model' && !isLocalModelProviderConfigAccount(account))
        .map((account) => account.model?.trim())
        .filter((value): value is string => Boolean(value)),
    ))
    : (config.model ? [config.model] : []);
  await updateAgentModelProvider(runtimeProviderKey, {
    baseUrl: config.baseUrl,
    api: config.apiProtocol || 'openai-completions',
    models: buildAgentProviderModels(config.type, modelIds, disableTools),
    apiKey: resolvedKey || undefined,
  });
}

async function syncProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
): Promise<RuntimeProviderSyncContext | null> {
  const context = await resolveRuntimeSyncContext(config);
  if (!context) {
    return null;
  }

  const legacyProviderKey = getLegacyOpenClawProviderKey(config.type, config.id);
  if (legacyProviderKey !== context.runtimeProviderKey) {
    await removeProviderFromOpenClaw(legacyProviderKey);
  }

  await syncProviderSecretToRuntime(config, context.runtimeProviderKey, apiKey);
  await syncRuntimeProviderConfig(config, context);
  await syncCustomProviderAgentModel(config, context.runtimeProviderKey, apiKey, context.disableTools);
  await removeLegacyLocalModelAliases(config);
  return context;
}

export async function syncSavedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  await rebuildOpenClawModelAllowlistFromAccounts();
  await reconcileRuntimeProvidersFromAccounts();

  const refreshMode = resolveProviderGatewayRefreshMode(config, context.runtimeProviderKey);
  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway ${refreshMode} after saving provider "${context.runtimeProviderKey}" config`,
    { mode: refreshMode },
  );
}

export async function syncUpdatedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  const ock = context.runtimeProviderKey;
  const fallbackModels = await getProviderFallbackModelRefs(config);

  const defaultProviderId = await getDefaultProvider();
  if (defaultProviderId === config.id) {
    const modelOverride = config.model ? `${ock}/${config.model}` : undefined;
    if (config.type === 'openai' && ock === OPENAI_OAUTH_RUNTIME_PROVIDER) {
      const normalizedModel = normalizeOpenAIOAuthModel(config.model);
      await setOpenClawDefaultModel(
        OPENAI_OAUTH_RUNTIME_PROVIDER,
        normalizedModel
          ? `${OPENAI_OAUTH_RUNTIME_PROVIDER}/${normalizedModel}`
          : OPENAI_OAUTH_DEFAULT_MODEL_REF,
        fallbackModels,
      );
    } else if (!isSelfHostedProviderType(config.type)) {
      if (shouldUseExplicitDefaultOverride(config, ock)) {
        await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
          baseUrl: normalizeProviderBaseUrl(config, config.baseUrl || context.meta?.baseUrl),
          api: context.api,
          apiKeyEnv: context.meta?.apiKeyEnv,
          headers: context.meta?.headers,
          allowPrivateNetwork: context.allowPrivateNetwork,
        }, fallbackModels);
      } else {
        await setOpenClawDefaultModel(ock, modelOverride, fallbackModels);
      }
    } else {
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: config.baseUrl,
        api: config.apiProtocol || 'openai-completions',
        disableTools: context.disableTools,
        allowPrivateNetwork: context.allowPrivateNetwork,
      }, fallbackModels);
    }
  }

  await rebuildOpenClawModelAllowlistFromAccounts();
  await reconcileRuntimeProvidersFromAccounts();

  const refreshMode = resolveProviderGatewayRefreshMode(config, ock);
  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway ${refreshMode} after updating provider "${ock}" config`,
    { mode: refreshMode },
  );
}

export async function syncDeletedProviderToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  gatewayManager?: GatewayManager,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeProviderFromOpenClaw(ock);
  if (provider.type === 'local-model') {
    const normalizedId = providerId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'default';
    await removeProviderFromOpenClaw(`custom-${normalizedId}`);
    await removeProviderFromOpenClaw(`local-model-${normalizedId}`);
  }
  await rebuildOpenClawModelAllowlistFromAccounts();
  await reconcileRuntimeProvidersFromAccounts();

  const refreshMode = resolveProviderGatewayRefreshMode(provider, ock);
  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway ${refreshMode} after deleting provider "${ock}"`,
    { mode: refreshMode },
  );
}

export async function syncDeletedProviderApiKeyToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeProviderFromOpenClaw(ock);
}

export async function syncDefaultProviderToRuntime(
  providerId: string,
  gatewayManagerOrOptions?: GatewayManager | {
    gatewayManager?: GatewayManager;
    suppressRefresh?: boolean;
  },
): Promise<void> {
  const gatewayManager =
    gatewayManagerOrOptions && 'getStatus' in gatewayManagerOrOptions
      ? gatewayManagerOrOptions
      : gatewayManagerOrOptions?.gatewayManager;
  const suppressRefresh =
    gatewayManagerOrOptions != null
    && (!('getStatus' in gatewayManagerOrOptions))
    && gatewayManagerOrOptions.suppressRefresh === true;
  const provider = await getProvider(providerId);
  if (!provider) {
    return;
  }
  const ock = await resolveRuntimeProviderKey(provider);
  const providerKey = await getApiKey(providerId);
  const fallbackModels = await getProviderFallbackModelRefs(provider);
  const oauthTypes = ['qwen-portal', 'minimax-portal', 'minimax-portal-cn'];
  const isGoogleOAuthProvider = await isGoogleBrowserOAuthProvider(provider);
  const isOpenAIOAuth = await isOpenAIOAuthProvider(provider);
  const isOAuthProvider = (oauthTypes.includes(provider.type) && !providerKey) || isGoogleOAuthProvider || isOpenAIOAuth;

  if (!isOAuthProvider) {
    const modelOverride = provider.model
      ? (provider.model.startsWith(`${ock}/`) ? provider.model : `${ock}/${provider.model}`)
      : undefined;

    if (isSelfHostedProviderType(provider.type)) {
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: provider.baseUrl,
        api: provider.apiProtocol || 'openai-completions',
        disableTools: provider.type === 'vllm',
      }, fallbackModels);
    } else if (shouldUseExplicitDefaultOverride(provider, ock)) {
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: normalizeProviderBaseUrl(provider, provider.baseUrl || getProviderConfig(provider.type)?.baseUrl),
        api: provider.apiProtocol || getProviderConfig(provider.type)?.api,
        apiKeyEnv: getProviderConfig(provider.type)?.apiKeyEnv,
        headers: getProviderConfig(provider.type)?.headers,
      }, fallbackModels);
    } else {
      await setOpenClawDefaultModel(ock, modelOverride, fallbackModels);
    }

    if (providerKey) {
      await saveProviderKeyToOpenClaw(ock, providerKey);
    }
  } else {
    if (isGoogleOAuthProvider) {
      const secret = await getProviderSecret(provider.id);
      if (secret?.type === 'oauth') {
        await saveOAuthTokenToOpenClaw(GOOGLE_OAUTH_RUNTIME_PROVIDER, {
          access: secret.accessToken,
          refresh: secret.refreshToken,
          expires: secret.expiresAt,
          email: secret.email,
          projectId: secret.subject,
        });
      }

      const modelOverride = provider.model
        ? (provider.model.startsWith(`${GOOGLE_OAUTH_RUNTIME_PROVIDER}/`)
          ? provider.model
          : `${GOOGLE_OAUTH_RUNTIME_PROVIDER}/${provider.model}`)
        : GOOGLE_OAUTH_DEFAULT_MODEL_REF;

      await setOpenClawDefaultModel(GOOGLE_OAUTH_RUNTIME_PROVIDER, modelOverride, fallbackModels);
      logger.info(`Configured openclaw.json for Google browser OAuth provider "${provider.id}"`);
      if (!suppressRefresh) {
        const refreshMode = resolveProviderGatewayRefreshMode(provider, GOOGLE_OAUTH_RUNTIME_PROVIDER);
        scheduleGatewayRefresh(
          gatewayManager,
          `Scheduling Gateway ${refreshMode} after provider switch to "${GOOGLE_OAUTH_RUNTIME_PROVIDER}"`,
          { mode: refreshMode },
        );
      }
      return;
    }

    if (isOpenAIOAuth) {
      const secret = await getProviderSecret(provider.id);
      if (secret?.type === 'oauth') {
        await saveOAuthTokenToOpenClaw(OPENAI_OAUTH_RUNTIME_PROVIDER, {
          access: secret.accessToken,
          refresh: secret.refreshToken,
          expires: secret.expiresAt,
          email: secret.email,
          projectId: secret.subject,
        });
      }

      const normalizedModel = normalizeOpenAIOAuthModel(provider.model);
      const modelOverride = normalizedModel
        ? `${OPENAI_OAUTH_RUNTIME_PROVIDER}/${normalizedModel}`
        : OPENAI_OAUTH_DEFAULT_MODEL_REF;

      await setOpenClawDefaultModel(OPENAI_OAUTH_RUNTIME_PROVIDER, modelOverride, fallbackModels);
      logger.info(`Configured openclaw.json for OpenAI OAuth provider "${provider.id}"`);
      if (!suppressRefresh) {
        const refreshMode = resolveProviderGatewayRefreshMode(provider, OPENAI_OAUTH_RUNTIME_PROVIDER);
        scheduleGatewayRefresh(
          gatewayManager,
          `Scheduling Gateway ${refreshMode} after provider switch to "${OPENAI_OAUTH_RUNTIME_PROVIDER}"`,
          { mode: refreshMode },
        );
      }
      return;
    }

    const defaultBaseUrl = provider.type === 'minimax-portal'
      ? 'https://api.minimax.io/anthropic'
      : (provider.type === 'minimax-portal-cn' ? 'https://api.minimaxi.com/anthropic' : 'https://portal.qwen.ai/v1');
    const api: 'anthropic-messages' | 'openai-completions' =
      (provider.type === 'minimax-portal' || provider.type === 'minimax-portal-cn')
        ? 'anthropic-messages'
        : 'openai-completions';

    let baseUrl = provider.baseUrl || defaultBaseUrl;
    if ((provider.type === 'minimax-portal' || provider.type === 'minimax-portal-cn') && baseUrl) {
      baseUrl = baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
    }

    const targetProviderKey = (provider.type === 'minimax-portal' || provider.type === 'minimax-portal-cn')
      ? 'minimax-portal'
      : provider.type;

    await setOpenClawDefaultModelWithOverride(targetProviderKey, getProviderModelRef(provider), {
      baseUrl,
      api,
      authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
      apiKeyEnv: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
    }, fallbackModels);

    logger.info(`Configured openclaw.json for OAuth provider "${provider.type}"`);
    // scheduleGatewayRefresh is already called by syncSavedProviderToRuntime (which runs
    // before this function and already scheduled a restart). Calling it again here would
    // emit an extra reload/restart signal that races with the one already queued.
    try {
      const defaultModelId = provider.model?.split('/').pop();
      await updateAgentModelProvider(targetProviderKey, {
        baseUrl,
        api,
        authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
        apiKey: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
        models: defaultModelId ? buildAgentProviderModels(provider.type, [defaultModelId], false) : [],
      });
    } catch (err) {
      logger.warn(`Failed to update models.json for OAuth provider "${targetProviderKey}":`, err);
    }
  }

  if (isSelfHostedProviderType(provider.type) && provider.type !== 'ollama' && provider.baseUrl) {
    const modelId = provider.model;
    await updateAgentModelProvider(ock, {
      baseUrl: provider.baseUrl,
      api: provider.apiProtocol || 'openai-completions',
      models: modelId
        ? buildAgentProviderModels(
          provider.type,
          [modelId],
          provider.type === 'vllm',
        )
        : [],
      apiKey: providerKey || undefined,
    });
  }

  await rebuildOpenClawModelAllowlistFromAccounts();
  await reconcileRuntimeProvidersFromAccounts();

  if (!suppressRefresh) {
    const refreshMode = resolveProviderGatewayRefreshMode(provider, ock);
    scheduleGatewayRefresh(
      gatewayManager,
      `Scheduling Gateway ${refreshMode} after provider switch to "${ock}"`,
      { onlyIfRunning: true, mode: refreshMode },
    );
  }
}
