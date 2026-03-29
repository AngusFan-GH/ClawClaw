import type { IncomingMessage, ServerResponse } from 'http';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  type ProviderConfig,
} from '../../utils/secure-storage';
import {
  getProviderConfig,
} from '../../utils/provider-registry';
import { deviceOAuthManager, type OAuthProviderType } from '../../utils/device-oauth';
import { browserOAuthManager, type BrowserOAuthProviderType } from '../../utils/browser-oauth';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  syncDefaultProviderToRuntime,
  syncDeletedProviderApiKeyToRuntime,
  syncDeletedProviderToRuntime,
  syncProviderApiKeyToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
} from '../../services/providers/provider-runtime-sync';
import { listModelsWithProvider, validateApiKeyWithProvider } from '../../services/providers/provider-validation';
import { getProviderService } from '../../services/providers/provider-service';
import { providerAccountToConfig } from '../../services/providers/provider-store';
import type { ProviderAccount } from '../../shared/providers/types';
import { logger } from '../../utils/logger';
import { getOpenClawCliSpawnConfig } from '../../utils/openclaw-cli';
import { prepareWinSpawn } from '../../utils/win-shell';
import { applyPresetLocalModelSelection, readLocalModelPresets } from '../../services/providers/local-model-presets';
import { getOpenClawProviderKeyForType } from '../../utils/provider-keys';
import { runOpenClawStartupPreflightRepair } from '../../gateway/config-sync';

type OpenClawModelListResponse = {
  count?: number;
  models?: Array<{
    key?: string;
    name?: string;
    input?: string;
    contextWindow?: number | null;
    tags?: string[];
    category?: string;
    local?: boolean | null;
    available?: boolean;
  }>;
};

type OpenClawModelScope = 'catalog' | 'runtime';
type ProviderModelOptionsSource = 'runtime' | 'models_json_fallback' | 'direct';
type OpenClawModelEntry = NonNullable<OpenClawModelListResponse['models']>[number];
type OpenClawModelCacheEntry = {
  expiresAt: number;
  promise?: Promise<OpenClawModelEntry[]>;
  value?: OpenClawModelEntry[];
};

const OPENCLAW_MODEL_LIST_CACHE_TTL_MS = 10_000;
const openClawModelListCache = new Map<OpenClawModelScope, OpenClawModelCacheEntry>();
let openClawModelListQueue: Promise<void> = Promise.resolve();
let openClawModelQueryPrepPromise: Promise<void> | null = null;

const WINDOWS_MODELS_JSON_RENAME_RETRY_DELAYS_MS = [120, 250, 500];

function isWindowsModelsJsonRenameError(error: unknown): boolean {
  const text = String(error);
  return (
    process.platform === 'win32'
    && text.includes('EPERM:')
    && text.includes('models.json')
    && text.includes('.tmp')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readMainAgentModelsJsonEntries(): Promise<OpenClawModelEntry[]> {
  const modelsPath = join(homedir(), '.openclaw', 'agents', 'main', 'agent', 'models.json');
  try {
    const raw = await readFile(modelsPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      providers?: Record<string, { models?: Array<{ id?: string; name?: string }> }>;
    };
    const providers = parsed?.providers ?? {};
    const entries: OpenClawModelEntry[] = [];
    for (const [providerKey, provider] of Object.entries(providers)) {
      for (const model of provider?.models ?? []) {
        if (!model?.id) continue;
        entries.push({
          key: `${providerKey}/${model.id}`,
          name: model.name || model.id,
          available: true,
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

async function runSerializedOpenClawModelList<T>(task: () => Promise<T>): Promise<T> {
  const previous = openClawModelListQueue;
  let release!: () => void;
  openClawModelListQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
  }
}

async function ensureOpenClawConfigReadyForModelQueries(): Promise<void> {
  if (!openClawModelQueryPrepPromise) {
    openClawModelQueryPrepPromise = (async () => {
      await runOpenClawStartupPreflightRepair();
    })().finally(() => {
      openClawModelQueryPrepPromise = null;
    });
  }

  await openClawModelQueryPrepPromise;
}

function isLocalModelProviderConfig(account: Pick<ProviderAccount, 'vendorId' | 'metadata'> | null | undefined): boolean {
  return account?.vendorId === 'local-model' && account.metadata?.localModelProvider === true;
}

function isLocalModelRuntimeAccount(account: Pick<ProviderAccount, 'vendorId' | 'metadata'> | null | undefined): boolean {
  return account?.vendorId === 'local-model' && account.metadata?.localModelProvider !== true;
}

function invalidateOpenClawModelListCache(): void {
  openClawModelListCache.clear();
}

function extractJsonObjectFromMixedOutput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (start === -1) {
      if (char === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseOpenClawModelListOutput(raw: string): OpenClawModelListResponse {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('openclaw models list returned empty output');
  }

  try {
    return JSON.parse(trimmed) as OpenClawModelListResponse;
  } catch {
    const jsonSlice = extractJsonObjectFromMixedOutput(trimmed);
    if (!jsonSlice) {
      throw new Error(`openclaw models list did not contain a JSON object. Output preview: ${trimmed.slice(0, 240)}`);
    }
    return JSON.parse(jsonSlice) as OpenClawModelListResponse;
  }
}

async function fetchOpenClawModelListOnce(scope: OpenClawModelScope): Promise<OpenClawModelEntry[]> {
  const cliArgs = scope === 'runtime'
    ? ['models', 'list', '--json']
    : ['models', 'list', '--all', '--json'];
  const { command, args, env, cwd } = getOpenClawCliSpawnConfig(cliArgs);
  const prepared = prepareWinSpawn(command, args);

  return await new Promise((resolve, reject) => {
    const child = spawn(prepared.command, prepared.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: prepared.shell,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `openclaw models list exited with code ${code}`));
        return;
      }
      try {
        const parsed = parseOpenClawModelListOutput(stdout);
        resolve(parsed.models ?? []);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function fetchOpenClawModelList(scope: OpenClawModelScope): Promise<OpenClawModelEntry[]> {
  let attempt = 0;
  for (;;) {
    try {
      return await runSerializedOpenClawModelList(() => fetchOpenClawModelListOnce(scope));
    } catch (error) {
      if (
        !isWindowsModelsJsonRenameError(error)
        || attempt >= WINDOWS_MODELS_JSON_RENAME_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }

      const delayMs = WINDOWS_MODELS_JSON_RENAME_RETRY_DELAYS_MS[attempt];
      attempt += 1;
      logger.warn(
        `[providers] openclaw models list hit Windows models.json rename lock; retrying in ${delayMs}ms (attempt ${attempt})`,
      );
      await sleep(delayMs);
    }
  }
}

async function getOpenClawModelList(scope: OpenClawModelScope): Promise<OpenClawModelEntry[]> {
  const now = Date.now();
  const cached = openClawModelListCache.get(scope);
  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached?.promise) {
    return await cached.promise;
  }

  const promise = fetchOpenClawModelList(scope)
    .then((models) => {
      openClawModelListCache.set(scope, {
        value: models,
        expiresAt: Date.now() + OPENCLAW_MODEL_LIST_CACHE_TTL_MS,
      });
      return models;
    })
    .catch((error) => {
      openClawModelListCache.delete(scope);
      throw error;
    });

  openClawModelListCache.set(scope, {
    promise,
    expiresAt: now + OPENCLAW_MODEL_LIST_CACHE_TTL_MS,
  });

  return await promise;
}

async function listRuntimeModelRefs(): Promise<string[]> {
  const models = await getOpenClawModelList('runtime');
  const refs = models
    .filter((model) => model.available !== false)
    .map((model) => (typeof model.key === 'string' ? model.key : ''))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(refs));
}

const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';
const OPENAI_OAUTH_PREFERRED_MODEL = 'gpt-5.4';

function normalizeProviderModelId(runtimeProviderId: string, modelId: string): string {
  if (
    runtimeProviderId === OPENAI_OAUTH_RUNTIME_PROVIDER
    && (modelId === 'gpt-5.2' || modelId === 'gpt-5.3-codex')
  ) {
    return OPENAI_OAUTH_PREFERRED_MODEL;
  }
  return modelId;
}

function compareProviderModelOptions(
  runtimeProviderId: string,
  left: { id: string; name: string },
  right: { id: string; name: string },
): number {
  if (runtimeProviderId === OPENAI_OAUTH_RUNTIME_PROVIDER) {
    if (left.id === OPENAI_OAUTH_PREFERRED_MODEL && right.id !== OPENAI_OAUTH_PREFERRED_MODEL) {
      return -1;
    }
    if (right.id === OPENAI_OAUTH_PREFERRED_MODEL && left.id !== OPENAI_OAUTH_PREFERRED_MODEL) {
      return 1;
    }
  }

  return left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
}

function getRuntimeProviderId(vendorId: string, authMode?: string | null): string {
  if (vendorId === 'openai' && (authMode === 'oauth_browser' || authMode === 'oauth_device')) {
    return OPENAI_OAUTH_RUNTIME_PROVIDER;
  }
  if (vendorId === 'google' && authMode === 'oauth_browser') {
    return 'google-gemini-cli';
  }
  return vendorId;
}

async function resolveRuntimeProviderId(
  providerService: ReturnType<typeof getProviderService>,
  vendorId: string,
  authMode?: string | null,
  accountId?: string | null,
): Promise<string> {
  if (!accountId) {
    return getRuntimeProviderId(vendorId, authMode);
  }

  const account = await providerService.getAccount(accountId);
  if (!account) {
    return getRuntimeProviderId(vendorId, authMode);
  }

  if (
    account.vendorId === 'openai'
    && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device')
  ) {
    return OPENAI_OAUTH_RUNTIME_PROVIDER;
  }

  if (account.vendorId === 'google' && account.authMode === 'oauth_browser') {
    return 'google-gemini-cli';
  }

  return getOpenClawProviderKeyForType(account.vendorId, account.id);
}

async function listProviderModelOptions(
  runtimeProviderId: string,
  scope: 'catalog' | 'runtime' = 'catalog',
  options?: { allowModelsJsonFallback?: boolean },
): Promise<{
  models: Array<{
    id: string;
    name: string;
    input?: string;
    contextWindow?: number | null;
    tags?: string[];
    category?: string;
  }>;
  source: ProviderModelOptionsSource;
}> {
  let parsedModels: OpenClawModelEntry[];
  let source: ProviderModelOptionsSource = 'runtime';

  try {
    parsedModels = await getOpenClawModelList(scope);
  } catch (error) {
    const allowModelsJsonFallback = options?.allowModelsJsonFallback
      && process.platform === 'win32'
      && scope === 'runtime';
    if (!allowModelsJsonFallback) {
      throw error;
    }

    logger.warn(
      `[providers] Falling back to main agent models.json for ${runtimeProviderId} after OpenClaw model listing failed:`,
      error,
    );
    parsedModels = await readMainAgentModelsJsonEntries();
    source = 'models_json_fallback';
  }

  const models = parsedModels
    .filter((model) => typeof model.key === 'string' && model.key.startsWith(`${runtimeProviderId}/`))
    .filter((model) => model.available !== false)
    .map((model) => ({
      id: normalizeProviderModelId(
        runtimeProviderId,
        String(model.key).slice(runtimeProviderId.length + 1),
      ),
      name:
        normalizeProviderModelId(
          runtimeProviderId,
          model.name || String(model.key).slice(runtimeProviderId.length + 1),
        ),
      input: typeof model.input === 'string' ? model.input : undefined,
      contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : undefined,
      tags: Array.isArray(model.tags)
        ? model.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
        : undefined,
      category: typeof model.category === 'string' && model.category.trim().length > 0
        ? model.category.trim()
        : undefined,
    }));

  return {
    models: Array.from(
    new Map(models.map((model) => [model.id, model])).values(),
    ).sort((left, right) => compareProviderModelOptions(runtimeProviderId, left, right)),
    source,
  };
}

async function listProviderModelOptionsWithRuntimeFallback(
  runtimeProviderId: string,
  scope: 'catalog' | 'runtime',
  options?: { allowModelsJsonFallback?: boolean },
): Promise<{
  models: Array<{
    id: string;
    name: string;
    input?: string;
    contextWindow?: number | null;
    tags?: string[];
    category?: string;
  }>;
  source: ProviderModelOptionsSource;
}> {
  const primary = await listProviderModelOptions(runtimeProviderId, scope, options);
  if (scope !== 'catalog' || primary.models.length > 0) {
    return primary;
  }

  return await listProviderModelOptions(runtimeProviderId, 'runtime', {
    allowModelsJsonFallback: false,
  });
}

function isRuntimeOnlyModelCatalog(vendorId: string, authMode?: string | null): boolean {
  return (
    (vendorId === 'openai' && (authMode === 'oauth_browser' || authMode === 'oauth_device'))
    || (vendorId === 'google' && authMode === 'oauth_browser')
  );
}

async function resolveRuntimeOnlyModelCatalog(
  providerService: ReturnType<typeof getProviderService>,
  vendorId: string,
  authMode?: string | null,
  accountId?: string | null,
): Promise<boolean> {
  if (!accountId) {
    return isRuntimeOnlyModelCatalog(vendorId, authMode);
  }

  const account = await providerService.getAccount(accountId);
  if (!account) {
    return isRuntimeOnlyModelCatalog(vendorId, authMode);
  }

  return isRuntimeOnlyModelCatalog(account.vendorId, account.authMode);
}

async function resolveLocalModelRuntimeConfig(
  providerService: ReturnType<typeof getProviderService>,
): Promise<{ baseUrl?: string; apiProtocol?: string } | null> {
  const accounts = await providerService.listAccounts();
  const localAccount = accounts.find((account) => (
    account.vendorId === 'custom'
    && (account.metadata?.localModel || account.metadata?.managedBy === 'preset-local-model')
    && account.baseUrl
  ));
  if (localAccount?.baseUrl) {
    return {
      baseUrl: localAccount.baseUrl,
      apiProtocol: localAccount.apiProtocol || 'openai-completions',
    };
  }

  const presets = await readLocalModelPresets().catch(() => []);
  const primaryPreset = presets[0];
  if (!primaryPreset?.baseUrl) {
    return null;
  }

  return {
    baseUrl: primaryPreset.baseUrl,
    apiProtocol: primaryPreset.apiProtocol || 'openai-completions',
  };
}

const legacyProviderRoutesWarned = new Set<string>();

export async function handleProviderRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const providerService = getProviderService();
  const logLegacyProviderRoute = (route: string): void => {
    if (route.startsWith('POST /api/providers/oauth/')) {
      return;
    }
    if (legacyProviderRoutesWarned.has(route)) return;
    legacyProviderRoutesWarned.add(route);
    logger.warn(
      `[provider-migration] Legacy HTTP route "${route}" is deprecated. Prefer /api/provider-accounts endpoints.`,
    );
  };

  if (url.pathname === '/api/provider-vendors' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listVendors());
    return true;
  }

  if (url.pathname === '/api/local-model-runtime-config' && req.method === 'GET') {
    try {
      const config = await resolveLocalModelRuntimeConfig(providerService);
      sendJson(res, 200, { config });
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-model-options' && req.method === 'GET') {
    try {
      await ensureOpenClawConfigReadyForModelQueries();
      const vendorId = url.searchParams.get('vendorId');
      const authMode = url.searchParams.get('authMode');
      const accountId = url.searchParams.get('accountId');
      const scopeParam = url.searchParams.get('scope');
      let scope: 'catalog' | 'runtime' = scopeParam === 'runtime' ? 'runtime' : 'catalog';
      if (!vendorId) {
        sendJson(res, 400, { error: 'vendorId is required' });
        return true;
      }
      const runtimeProviderId = await resolveRuntimeProviderId(
        providerService,
        vendorId,
        authMode,
        accountId,
      );
      const runtimeOnlyCatalog = await resolveRuntimeOnlyModelCatalog(
        providerService,
        vendorId,
        authMode,
        accountId,
      );
      const { models, source } = await listProviderModelOptionsWithRuntimeFallback(runtimeProviderId, scope, {
        allowModelsJsonFallback: !runtimeOnlyCatalog,
      });
      sendJson(res, 200, { runtimeProviderId, models, source });
    } catch (error) {
      logger.warn('[providers] Failed to list provider model options:', error);
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-model-options/resolve' && req.method === 'POST') {
    try {
      await ensureOpenClawConfigReadyForModelQueries();
      const body = await parseJsonBody<{
        vendorId: string;
        authMode?: string;
        accountId?: string;
        baseUrl?: string;
        apiProtocol?: string;
        apiKey?: string;
      }>(req);
      if (!body.vendorId) {
        sendJson(res, 400, { error: 'vendorId is required' });
        return true;
      }

      const runtimeProviderId = await resolveRuntimeProviderId(
        providerService,
        body.vendorId,
        body.authMode,
        body.accountId,
      );

      if (
        body.authMode === 'oauth_browser'
        || body.authMode === 'oauth_device'
      ) {
        const { models, source } = await listProviderModelOptions(runtimeProviderId, 'runtime', {
          allowModelsJsonFallback: false,
        });
        sendJson(res, 200, { runtimeProviderId, models, resolved: true, source });
        return true;
      }

      const result = await listModelsWithProvider(body.vendorId, body.apiKey, {
        baseUrl: body.baseUrl,
        apiProtocol: body.apiProtocol,
      });
      if (result.error) {
        sendJson(res, 400, { runtimeProviderId, models: [], resolved: false, error: result.error });
        return true;
      }
      sendJson(res, 200, { runtimeProviderId, models: result.models, resolved: true, source: 'direct' });
    } catch (error) {
      logger.warn('[providers] Failed to resolve provider model options:', error);
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/runtime-model-refs' && req.method === 'GET') {
    try {
      await ensureOpenClawConfigReadyForModelQueries();
      const models = await listRuntimeModelRefs();
      sendJson(res, 200, { models });
    } catch (error) {
      logger.warn('[providers] Failed to list runtime model refs:', error);
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/local-model-presets' && req.method === 'GET') {
    try {
      const presets = await readLocalModelPresets();
      sendJson(
        res,
        200,
        presets.map(({ apiKey: _apiKey, ...preset }) => preset),
      );
    } catch (error) {
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (
    url.pathname.startsWith('/api/local-model-presets/')
    && url.pathname.endsWith('/activate')
    && req.method === 'POST'
  ) {
    try {
      const presetId = decodeURIComponent(
        url.pathname.slice('/api/local-model-presets/'.length, -'/activate'.length),
      );
      const result = await applyPresetLocalModelSelection(presetId, ctx.gatewayManager);
      const account = await providerService.getAccount(result.accountId);
      invalidateOpenClawModelListCache();
      sendJson(res, 200, { success: true, account, primaryPresetId: result.primaryPresetId });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listAccounts());
    return true;
  }

  if (url.pathname === '/api/provider-accounts/statuses' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listAccountStatuses());
    return true;
  }

  if (url.pathname === '/api/provider-accounts' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ account: ProviderAccount; apiKey?: string }>(req);
      const account = await providerService.createAccount(body.account, body.apiKey);
      if (isLocalModelProviderConfig(account)) {
        await syncDeletedProviderToRuntime(
          providerAccountToConfig(account),
          account.id,
          ctx.gatewayManager,
        );
        invalidateOpenClawModelListCache();
      } else {
        await syncSavedProviderToRuntime(providerAccountToConfig(account), body.apiKey, ctx.gatewayManager);
        invalidateOpenClawModelListCache();
      }
      sendJson(res, 200, { success: true, account });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts/default' && req.method === 'GET') {
    sendJson(res, 200, { accountId: await providerService.getDefaultAccountId() ?? null });
    return true;
  }

  if (url.pathname === '/api/provider-accounts/default' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ accountId: string }>(req);
      const account = await providerService.getAccount(body.accountId);
      if (isLocalModelProviderConfig(account)) {
        sendJson(res, 400, { success: false, error: 'Local model provider config cannot be set as default' });
        return true;
      }
      await providerService.setDefaultAccount(body.accountId);
      await syncDefaultProviderToRuntime(body.accountId, ctx.gatewayManager);
      invalidateOpenClawModelListCache();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'GET') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    sendJson(res, 200, await providerService.getAccount(accountId));
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'PUT') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    try {
      const body = await parseJsonBody<{ updates: Partial<ProviderAccount>; apiKey?: string }>(req);
      const existing = await providerService.getAccount(accountId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: 'Provider account not found' });
        return true;
      }
      const nextAccount = await providerService.updateAccount(accountId, body.updates, body.apiKey);
      if (isLocalModelProviderConfig(nextAccount)) {
        await syncDeletedProviderToRuntime(
          providerAccountToConfig(nextAccount),
          accountId,
          ctx.gatewayManager,
        );
        invalidateOpenClawModelListCache();
      } else {
        await syncUpdatedProviderToRuntime(providerAccountToConfig(nextAccount), body.apiKey, ctx.gatewayManager);
        invalidateOpenClawModelListCache();
      }
      sendJson(res, 200, { success: true, account: nextAccount });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'DELETE') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    try {
      const existing = await providerService.getAccount(accountId);
      const orphanedLocalModelAccounts = isLocalModelProviderConfig(existing)
        ? (await providerService.listAccounts()).filter((account) => (
            account.id !== accountId
            && isLocalModelRuntimeAccount(account)
          ))
        : [];
      const runtimeProviderKey = existing?.vendorId === 'google' && existing.authMode === 'oauth_browser'
        ? 'google-gemini-cli'
        : existing?.vendorId === 'openai'
            && (existing.authMode === 'oauth_browser' || existing.authMode === 'oauth_device')
          ? 'openai-codex'
        : undefined;
      if (url.searchParams.get('apiKeyOnly') === '1') {
        await providerService.deleteLegacyProviderApiKey(accountId);
        await syncDeletedProviderApiKeyToRuntime(
          existing ? providerAccountToConfig(existing) : null,
          accountId,
          runtimeProviderKey,
        );
        invalidateOpenClawModelListCache();
        sendJson(res, 200, { success: true });
        return true;
      }
      for (const localModelAccount of orphanedLocalModelAccounts) {
        await providerService.deleteAccount(localModelAccount.id);
        await syncDeletedProviderToRuntime(
          providerAccountToConfig(localModelAccount),
          localModelAccount.id,
          ctx.gatewayManager,
        );
      }
      await providerService.deleteAccount(accountId);
      await syncDeletedProviderToRuntime(
        existing ? providerAccountToConfig(existing) : null,
        accountId,
        ctx.gatewayManager,
        runtimeProviderKey,
      );
      invalidateOpenClawModelListCache();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers' && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers');
    sendJson(res, 200, await providerService.listLegacyProvidersWithKeyInfo());
    return true;
  }

  if (url.pathname === '/api/providers/default' && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers/default');
    sendJson(res, 200, { providerId: await providerService.getDefaultLegacyProvider() ?? null });
    return true;
  }

  if (url.pathname === '/api/providers/default' && req.method === 'PUT') {
    logLegacyProviderRoute('PUT /api/providers/default');
    try {
      const body = await parseJsonBody<{ providerId: string }>(req);
      await providerService.setDefaultLegacyProvider(body.providerId);
      await syncDefaultProviderToRuntime(body.providerId, ctx.gatewayManager);
      invalidateOpenClawModelListCache();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/validate' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/validate');
    try {
      const body = await parseJsonBody<{ providerId: string; apiKey: string; options?: { baseUrl?: string; apiProtocol?: string } }>(req);
      const provider = await providerService.getLegacyProvider(body.providerId);
      const providerType = provider?.type || body.providerId;
      const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
      const resolvedBaseUrl = body.options?.baseUrl || provider?.baseUrl || registryBaseUrl;
      const resolvedProtocol = body.options?.apiProtocol || provider?.apiProtocol;
      sendJson(res, 200, await validateApiKeyWithProvider(providerType, body.apiKey, {
        baseUrl: resolvedBaseUrl,
        apiProtocol: resolvedProtocol,
      }));
    } catch (error) {
      sendJson(res, 500, { valid: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/start' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/start');
    try {
      const body = await parseJsonBody<{
        provider: OAuthProviderType | BrowserOAuthProviderType;
        region?: 'global' | 'cn';
        accountId?: string;
        label?: string;
        model?: string;
      }>(req);
      if (body.provider === 'google') {
        void browserOAuthManager.startFlow(body.provider, {
          accountId: body.accountId,
          label: body.label,
          model: body.model,
        }).catch((error) => {
          logger.error('[providers] Browser OAuth start failed:', error);
        });
      } else {
        void deviceOAuthManager.startFlow(body.provider, body.region, {
          accountId: body.accountId,
          label: body.label,
          model: body.provider === 'openai' ? undefined : body.model,
        }).catch((error) => {
          logger.error('[providers] Device OAuth start failed:', error);
        });
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/cancel' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/cancel');
    try {
      await deviceOAuthManager.stopFlow();
      await browserOAuthManager.stopFlow();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/respond' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/respond');
    try {
      const body = await parseJsonBody<{ input: string }>(req);
      deviceOAuthManager.submitPromptInput(body.input);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers');
    try {
      const body = await parseJsonBody<{ config: ProviderConfig; apiKey?: string }>(req);
      const config = body.config;
      await providerService.saveLegacyProvider(config);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(config.id, trimmedKey);
          await syncProviderApiKeyToRuntime(config.type, config.id, trimmedKey);
        }
      }
      await syncSavedProviderToRuntime(config, body.apiKey, ctx.gatewayManager);
      invalidateOpenClawModelListCache();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    if (providerId.endsWith('/api-key')) {
      const actualId = providerId.slice(0, -('/api-key'.length));
      sendJson(res, 200, { apiKey: await providerService.getLegacyProviderApiKey(actualId) });
      return true;
    }
    if (providerId.endsWith('/has-api-key')) {
      const actualId = providerId.slice(0, -('/has-api-key'.length));
      sendJson(res, 200, { hasKey: await providerService.hasLegacyProviderApiKey(actualId) });
      return true;
    }
    sendJson(res, 200, await providerService.getLegacyProvider(providerId));
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'PUT') {
    logLegacyProviderRoute('PUT /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    try {
      const body = await parseJsonBody<{ updates: Partial<ProviderConfig>; apiKey?: string }>(req);
      const existing = await providerService.getLegacyProvider(providerId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: 'Provider not found' });
        return true;
      }
      const nextConfig: ProviderConfig = { ...existing, ...body.updates, updatedAt: new Date().toISOString() };
      await providerService.saveLegacyProvider(nextConfig);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(providerId, trimmedKey);
          await syncProviderApiKeyToRuntime(nextConfig.type, providerId, trimmedKey);
        } else {
          await providerService.deleteLegacyProviderApiKey(providerId);
          await syncDeletedProviderApiKeyToRuntime(existing, providerId);
        }
      }
      await syncUpdatedProviderToRuntime(nextConfig, body.apiKey, ctx.gatewayManager);
      invalidateOpenClawModelListCache();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'DELETE') {
    logLegacyProviderRoute('DELETE /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    try {
      const existing = await providerService.getLegacyProvider(providerId);
      if (url.searchParams.get('apiKeyOnly') === '1') {
        await providerService.deleteLegacyProviderApiKey(providerId);
        await syncDeletedProviderApiKeyToRuntime(existing, providerId);
        invalidateOpenClawModelListCache();
        sendJson(res, 200, { success: true });
        return true;
      }
      await providerService.deleteLegacyProvider(providerId);
      await syncDeletedProviderToRuntime(existing, providerId, ctx.gatewayManager);
      invalidateOpenClawModelListCache();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
