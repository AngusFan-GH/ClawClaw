import type { IncomingMessage, ServerResponse } from 'http';
import { spawn } from 'node:child_process';
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
import { validateApiKeyWithProvider } from '../../services/providers/provider-validation';
import { getProviderService } from '../../services/providers/provider-service';
import { providerAccountToConfig } from '../../services/providers/provider-store';
import type { ProviderAccount } from '../../shared/providers/types';
import { logger } from '../../utils/logger';
import { getOpenClawCliSpawnConfig } from '../../utils/openclaw-cli';
import { applyPresetLocalModelSelection, readLocalModelPresets } from '../../services/providers/local-model-presets';
import { getOpenClawProviderKeyForType } from '../../utils/provider-keys';

type OpenClawModelListResponse = {
  count?: number;
  models?: Array<{
    key?: string;
    name?: string;
    available?: boolean;
  }>;
};

async function listRuntimeModelRefs(): Promise<string[]> {
  const { command, args, env, cwd } = getOpenClawCliSpawnConfig(['models', 'list', '--json']);
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
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
        const parsed = JSON.parse(stdout) as OpenClawModelListResponse;
        const refs = (parsed.models ?? [])
          .filter((model) => model.available !== false)
          .map((model) => (typeof model.key === 'string' ? model.key : ''))
          .filter((value): value is string => Boolean(value));
        resolve(Array.from(new Set(refs)));
      } catch (error) {
        reject(error);
      }
    });
  });
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
): Promise<Array<{ id: string; name: string }>> {
  const cliArgs = scope === 'runtime'
    ? ['models', 'list', '--json']
    : ['models', 'list', '--all', '--json'];
  const { command, args, env, cwd } = getOpenClawCliSpawnConfig(cliArgs);

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
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
        const parsed = JSON.parse(stdout) as OpenClawModelListResponse;
        const models = (parsed.models ?? [])
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
          }));

        const deduped = Array.from(
          new Map(models.map((model) => [model.id, model])).values(),
        ).sort((left, right) => compareProviderModelOptions(runtimeProviderId, left, right));
        resolve(deduped);
      } catch (error) {
        reject(error);
      }
    });
  });
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

  if (url.pathname === '/api/provider-model-options' && req.method === 'GET') {
    try {
      const vendorId = url.searchParams.get('vendorId');
      const authMode = url.searchParams.get('authMode');
      const accountId = url.searchParams.get('accountId');
      const scopeParam = url.searchParams.get('scope');
      const scope = scopeParam === 'runtime' ? 'runtime' : 'catalog';
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
      const models = await listProviderModelOptions(runtimeProviderId, scope);
      sendJson(res, 200, { runtimeProviderId, models });
    } catch (error) {
      logger.warn('[providers] Failed to list provider model options:', error);
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/runtime-model-refs' && req.method === 'GET') {
    try {
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
      await syncSavedProviderToRuntime(providerAccountToConfig(account), body.apiKey, ctx.gatewayManager);
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
      await providerService.setDefaultAccount(body.accountId);
      await syncDefaultProviderToRuntime(body.accountId, ctx.gatewayManager);
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
      await syncUpdatedProviderToRuntime(providerAccountToConfig(nextAccount), body.apiKey, ctx.gatewayManager);
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
        sendJson(res, 200, { success: true });
        return true;
      }
      await providerService.deleteAccount(accountId);
      await syncDeletedProviderToRuntime(
        existing ? providerAccountToConfig(existing) : null,
        accountId,
        ctx.gatewayManager,
        runtimeProviderKey,
      );
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
      sendJson(res, 200, await validateApiKeyWithProvider(providerType, body.apiKey, { baseUrl: resolvedBaseUrl, apiProtocol: resolvedProtocol as any }));
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
        sendJson(res, 200, { success: true });
        return true;
      }
      await providerService.deleteLegacyProvider(providerId);
      await syncDeletedProviderToRuntime(existing, providerId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
