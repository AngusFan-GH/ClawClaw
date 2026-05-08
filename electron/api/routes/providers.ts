import type { IncomingMessage, ServerResponse } from 'http';
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
  resolveProviderRuntimeApplyRequirement,
} from '../../services/providers/provider-runtime-sync';
import { listModelsWithProvider, validateApiKeyWithProvider } from '../../services/providers/provider-validation';
import { getProviderService } from '../../services/providers/provider-service';
import { providerAccountToConfig } from '../../services/providers/provider-store';
import {
  invalidateOpenClawModelListCache,
  listProviderModelOptions,
  listProviderModelOptionsWithRuntimeFallback,
  listRuntimeModelRefs,
} from '../../services/providers/provider-model-catalog';
import { beginProviderDraftSession } from '../../services/provider-draft-session';
import {
  resolveLocalModelRuntimeConfig,
  resolveProviderRuntime,
} from '../../services/providers/provider-runtime-resolver';
import type { ProviderAccount } from '../../shared/providers/types';
import { logger } from '../../utils/logger';
import { applyPresetLocalModelSelection, readLocalModelPresets } from '../../services/providers/local-model-presets';

function isLocalModelProviderConfig(account: Pick<ProviderAccount, 'vendorId' | 'metadata'> | null | undefined): boolean {
  return account?.vendorId === 'local-model' && account.metadata?.localModelProvider === true;
}

function isLocalModelRuntimeAccount(account: Pick<ProviderAccount, 'vendorId' | 'metadata'> | null | undefined): boolean {
  return account?.vendorId === 'local-model' && account.metadata?.localModelProvider !== true;
}

const legacyProviderRoutesWarned = new Set<string>();

function scheduleProviderRuntimeApply(
  ctx: HostApiContext,
  config: ProviderConfig,
  source: string,
  reason = source,
): void {
  ctx.runtimeApplyPlan.record({
    domain: 'providers',
    label: '模型配置',
    source,
    reason,
    requires: resolveProviderRuntimeApplyRequirement(config),
  });
}

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
      const vendorId = url.searchParams.get('vendorId');
      const authMode = url.searchParams.get('authMode');
      const accountId = url.searchParams.get('accountId');
      const scopeParam = url.searchParams.get('scope');
      let scope: 'catalog' | 'runtime' = scopeParam === 'runtime' ? 'runtime' : 'catalog';
      if (!vendorId) {
        sendJson(res, 400, { error: 'vendorId is required' });
        return true;
      }
      const { runtimeProviderId, runtimeOnlyCatalog } = await resolveProviderRuntime(
        providerService,
        vendorId,
        authMode,
        accountId,
      );
      const effectiveScope: 'catalog' | 'runtime' = runtimeOnlyCatalog ? 'runtime' : scope;
      const { models, source } = await listProviderModelOptionsWithRuntimeFallback(runtimeProviderId, effectiveScope, ctx, {
        allowModelsJsonFallback: !runtimeOnlyCatalog,
      });
      sendJson(res, 200, { runtimeProviderId, models, source, scope: effectiveScope });
    } catch (error) {
      logger.warn('[providers] Failed to list provider model options:', error);
      sendJson(res, 500, { error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-model-options/resolve' && req.method === 'POST') {
    try {
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

      const { runtimeProviderId } = await resolveProviderRuntime(
        providerService,
        body.vendorId,
        body.authMode,
        body.accountId,
      );

      if (
        body.authMode === 'oauth_browser'
        || body.authMode === 'oauth_device'
      ) {
        const { models, source } = await listProviderModelOptions(runtimeProviderId, 'runtime', ctx, {
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
      const refs = await listRuntimeModelRefs(ctx);
      sendJson(res, 200, { refs });
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
      await beginProviderDraftSession();
      const account = await providerService.createAccount(body.account, body.apiKey);
      scheduleProviderRuntimeApply(
        ctx,
        providerAccountToConfig(account),
        `provider-account:create:${account.id}`,
      );
      invalidateOpenClawModelListCache();
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
      await beginProviderDraftSession();
      await providerService.setDefaultAccount(body.accountId);
      scheduleProviderRuntimeApply(
        ctx,
        providerAccountToConfig(account),
        `provider-account:set-default:${body.accountId}`,
      );
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
      await beginProviderDraftSession();
      const nextAccount = await providerService.updateAccount(accountId, body.updates, body.apiKey);
      scheduleProviderRuntimeApply(
        ctx,
        providerAccountToConfig(nextAccount),
        `provider-account:update:${accountId}`,
      );
      invalidateOpenClawModelListCache();
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
      if (url.searchParams.get('apiKeyOnly') === '1') {
        await beginProviderDraftSession();
        await providerService.deleteLegacyProviderApiKey(accountId);
        if (existing) {
          scheduleProviderRuntimeApply(
            ctx,
            providerAccountToConfig(existing),
            `provider-account:delete-api-key:${accountId}`,
          );
        }
        invalidateOpenClawModelListCache();
        sendJson(res, 200, { success: true });
        return true;
      }
      await beginProviderDraftSession();
      for (const localModelAccount of orphanedLocalModelAccounts) {
        await providerService.deleteAccount(localModelAccount.id);
      }
      await providerService.deleteAccount(accountId);
      const deletedConfig = existing ? providerAccountToConfig(existing) : null;
      if (deletedConfig) {
        scheduleProviderRuntimeApply(
          ctx,
          deletedConfig,
          `provider-account:delete:${accountId}`,
        );
      }
      for (const localModelAccount of orphanedLocalModelAccounts) {
        scheduleProviderRuntimeApply(
          ctx,
          providerAccountToConfig(localModelAccount),
          `provider-account:delete:${localModelAccount.id}`,
        );
      }
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
      const provider = await providerService.getLegacyProvider(body.providerId);
      if (!provider) {
        sendJson(res, 404, { success: false, error: 'Provider not found' });
        return true;
      }
      await beginProviderDraftSession();
      await providerService.setDefaultLegacyProvider(body.providerId);
      scheduleProviderRuntimeApply(
        ctx,
        provider,
        `provider:set-default:${body.providerId}`,
      );
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
      await beginProviderDraftSession();
      await providerService.saveLegacyProvider(config);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(config.id, trimmedKey);
        }
      }
      scheduleProviderRuntimeApply(
        ctx,
        config,
        `provider:create:${config.id}`,
      );
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
      await beginProviderDraftSession();
      const nextConfig: ProviderConfig = { ...existing, ...body.updates, updatedAt: new Date().toISOString() };
      await providerService.saveLegacyProvider(nextConfig);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(providerId, trimmedKey);
        } else {
          await providerService.deleteLegacyProviderApiKey(providerId);
        }
      }
      scheduleProviderRuntimeApply(
        ctx,
        nextConfig,
        `provider:update:${providerId}`,
      );
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
        await beginProviderDraftSession();
        await providerService.deleteLegacyProviderApiKey(providerId);
        if (existing) {
          scheduleProviderRuntimeApply(
            ctx,
            existing,
            `provider:delete-api-key:${providerId}`,
          );
        }
        invalidateOpenClawModelListCache();
        sendJson(res, 200, { success: true });
        return true;
      }
      await beginProviderDraftSession();
      await providerService.deleteLegacyProvider(providerId);
      if (existing) {
        scheduleProviderRuntimeApply(
          ctx,
          existing,
          `provider:delete:${providerId}`,
        );
      }
      invalidateOpenClawModelListCache();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
