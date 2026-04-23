/**
 * IPC Handlers
 * Registers all IPC handlers for main-renderer communication
 */
import { ipcMain, BrowserWindow, shell, dialog, app, nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename, resolve } from 'node:path';
import crypto from 'node:crypto';
import { GatewayManager } from '../gateway/manager';
import { getDataDir, getLogsDir, getPortableDataDir } from '../utils/paths';
import {
  ClawHubService,
  ClawHubSearchParams,
  ClawHubInstallParams,
  ClawHubUninstallParams,
} from '../gateway/clawhub';
import { type ProviderConfig } from '../utils/secure-storage';
import {
  getOpenClawStatus,
  getOpenClawDir,
  getOpenClawConfigDir,
  getOpenClawSkillsDir,
  getDefaultExportDir,
  ensureDir,
  expandPath,
  resolveOpenClawDir,
} from '../utils/paths';
import { getOpenClawCliCommand } from '../utils/openclaw-cli';
import {
  getAllSettings,
  getSetting,
  resetSettings,
  setSetting,
  type AppSettings,
} from '../utils/store';
import { saveProviderKeyToOpenClaw, removeProviderFromOpenClaw } from '../utils/openclaw-auth';
import { logger } from '../utils/logger';
import { syncMemorySettingsToOpenClaw } from '../utils/openclaw-auth';
import { checkUvInstalled, installUv, setupManagedPython } from '../utils/uv-setup';
import { updateSkillConfig, getSkillConfig, getAllSkillConfigs } from '../utils/skill-config';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import { getProviderConfig } from '../utils/provider-registry';
import { deviceOAuthManager, OAuthProviderType } from '../utils/device-oauth';
import { browserOAuthManager, type BrowserOAuthProviderType } from '../utils/browser-oauth';
import { applyProxySettings } from './proxy';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { getRecentTokenUsageHistory } from '../utils/token-usage';
import { getProviderService } from '../services/providers/provider-service';
import {
  getOpenClawProviderKey,
  syncDefaultProviderToRuntime,
  syncDeletedProviderApiKeyToRuntime,
  syncDeletedProviderToRuntime,
  syncProviderApiKeyToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
} from '../services/providers/provider-runtime-sync';
import { validateApiKeyWithProvider } from '../services/providers/provider-validation';
import { appUpdater } from './updater';
import { PORTS } from '../utils/config';
import { quitApp, relaunchApp } from './quit';
import { getHostApiPort } from '../api/server';

type AppRequest = {
  id?: string;
  module: string;
  action: string;
  payload?: unknown;
};

type AppErrorCode =
  | 'VALIDATION'
  | 'PERMISSION'
  | 'TIMEOUT'
  | 'GATEWAY'
  | 'INTERNAL'
  | 'UNSUPPORTED';

type AppResponse = {
  id?: string;
  ok: boolean;
  data?: unknown;
  error?: {
    code: AppErrorCode;
    message: string;
    details?: unknown;
  };
};

/**
 * Register all IPC handlers
 */
export function registerIpcHandlers(
  gatewayManager: GatewayManager,
  clawHubService: ClawHubService,
  mainWindow: BrowserWindow
): void {
  // Unified request protocol (non-breaking: legacy channels remain available)
  registerUnifiedRequestHandlers(gatewayManager);

  // Host API proxy handlers
  registerHostApiProxyHandlers();

  // Gateway handlers
  registerGatewayHandlers(gatewayManager, mainWindow);

  // ClawHub handlers
  registerClawHubHandlers(clawHubService);

  // OpenClaw handlers
  registerOpenClawHandlers();

  // Provider handlers
  registerProviderHandlers(gatewayManager);

  // Shell handlers
  registerShellHandlers();

  // Dialog handlers
  registerDialogHandlers();

  // Session handlers
  registerSessionHandlers(gatewayManager);

  // App handlers
  registerAppHandlers();

  // Settings handlers
  registerSettingsHandlers(gatewayManager);

  // UV handlers
  registerUvHandlers();

  // Log handlers (for UI to read gateway/app logs)
  registerLogHandlers();

  // Usage handlers
  registerUsageHandlers();

  // Skill config handlers (direct file access, no Gateway RPC)
  registerSkillConfigHandlers();

  // Cron task handlers (proxy to Gateway RPC)
  registerCronHandlers(gatewayManager);

  // Window control handlers (for custom title bar on Windows/Linux)
  registerWindowHandlers(mainWindow);

  // WhatsApp handlers
  registerWhatsAppHandlers(mainWindow);

  // Device OAuth handlers (Code Plan)
  registerDeviceOAuthHandlers(mainWindow);

  // File staging handlers (upload/send separation)
  registerFileHandlers();
}

type HostApiFetchRequest = {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};

const DEFAULT_HOST_API_FETCH_TIMEOUT_MS = 15000;
const MAX_HOST_API_FETCH_TIMEOUT_MS = 180000;

function registerHostApiProxyHandlers(): void {
  ipcMain.handle('hostapi:fetch', async (_, request: HostApiFetchRequest) => {
    const startedAt = Date.now();
    try {
      const path = typeof request?.path === 'string' ? request.path : '';
      if (!path || !path.startsWith('/')) {
        throw new Error(`Invalid host API path: ${String(request?.path)}`);
      }

      const method = (request.method || 'GET').toUpperCase();
      const headers: Record<string, string> = { ...(request.headers || {}) };
      let body: string | undefined;

      if (request.body !== undefined && request.body !== null) {
        if (typeof request.body === 'string') {
          body = request.body;
        } else {
          body = JSON.stringify(request.body);
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
          }
        }
      }

      const hostApiPort = getHostApiPort();
      const url = `http://127.0.0.1:${hostApiPort}${path}`;
      logger.debug(`[hostapi:fetch] -> ${request.method || 'GET'} ${url}`);

      const timeoutMs =
        typeof request.timeoutMs === 'number' && Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
          ? Math.min(Math.floor(request.timeoutMs), MAX_HOST_API_FETCH_TIMEOUT_MS)
          : DEFAULT_HOST_API_FETCH_TIMEOUT_MS;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new Error(`Host API fetch timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      let response: Response;
      try {
        response = await proxyAwareFetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data: { status: number; ok: boolean; json?: unknown; text?: string } = {
        status: response.status,
        ok: response.ok,
      };

      if (response.status !== 204) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data.json = await response.json().catch(() => undefined);
        } else {
          data.text = await response.text().catch(() => '');
        }
      }

      logger.debug(
        `[hostapi:fetch] <- ${method} ${path} status=${response.status} durationMs=${Date.now() - startedAt}`,
      );
      return { ok: true, data };
    } catch (error) {
      const path = typeof request?.path === 'string' ? request.path : '<invalid>';
      logger.warn(
        `[hostapi:fetch] !! ${request.method || 'GET'} ${path} durationMs=${Date.now() - startedAt} error=${error instanceof Error ? error.stack || error.message : String(error)}`,
      );
      return {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
}

function mapAppErrorCode(error: unknown): AppErrorCode {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (msg.includes('timeout')) return 'TIMEOUT';
  if (msg.includes('permission') || msg.includes('denied') || msg.includes('forbidden'))
    return 'PERMISSION';
  if (msg.includes('gateway')) return 'GATEWAY';
  if (msg.includes('invalid') || msg.includes('required')) return 'VALIDATION';
  return 'INTERNAL';
}

function registerUnifiedRequestHandlers(gatewayManager: GatewayManager): void {
  const providerService = getProviderService();

  ipcMain.handle('app:request', async (_, request: AppRequest): Promise<AppResponse> => {
    if (!request || typeof request.module !== 'string' || typeof request.action !== 'string') {
      return {
        id: request?.id,
        ok: false,
        error: { code: 'VALIDATION', message: 'Invalid app request format' },
      };
    }

    try {
      let data: unknown;
      switch (request.module) {
        case 'app': {
          if (request.action === 'version') data = app.getVersion();
          else if (request.action === 'name') data = app.getName();
          else if (request.action === 'platform') data = process.platform;
          else {
            return {
              id: request.id,
              ok: false,
              error: {
                code: 'UNSUPPORTED',
                message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
              },
            };
          }
          break;
        }
        case 'provider': {
          if (request.action === 'list') {
            data = await providerService.listLegacyProvidersWithKeyInfo();
            break;
          }
          if (request.action === 'get') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.get payload');
            data = await providerService.getLegacyProvider(providerId);
            break;
          }
          if (request.action === 'getDefault') {
            data = await providerService.getDefaultLegacyProvider();
            break;
          }
          if (request.action === 'hasApiKey') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.hasApiKey payload');
            data = await providerService.hasLegacyProviderApiKey(providerId);
            break;
          }
          if (request.action === 'getApiKey') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.getApiKey payload');
            data = await providerService.getLegacyProviderApiKey(providerId);
            break;
          }
          if (request.action === 'validateKey') {
            const payload = request.payload as
              | { providerId?: string; apiKey?: string; options?: { baseUrl?: string } }
              | [string, string, { baseUrl?: string }?]
              | undefined;
            const providerId = Array.isArray(payload) ? payload[0] : payload?.providerId;
            const apiKey = Array.isArray(payload) ? payload[1] : payload?.apiKey;
            const options = Array.isArray(payload) ? payload[2] : payload?.options;
            if (!providerId || typeof apiKey !== 'string') {
              throw new Error('Invalid provider.validateKey payload');
            }

            const provider = await providerService.getLegacyProvider(providerId);
            const providerType = provider?.type || providerId;
            const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
            const resolvedBaseUrl = options?.baseUrl || provider?.baseUrl || registryBaseUrl;
            data = await validateApiKeyWithProvider(providerType, apiKey, {
              baseUrl: resolvedBaseUrl,
            });
            break;
          }
          if (request.action === 'save') {
            const payload = request.payload as
              | { config?: ProviderConfig; apiKey?: string }
              | [ProviderConfig, string?]
              | undefined;
            const config = Array.isArray(payload) ? payload[0] : payload?.config;
            const apiKey = Array.isArray(payload) ? payload[1] : payload?.apiKey;
            if (!config) throw new Error('Invalid provider.save payload');

            try {
              await providerService.saveLegacyProvider(config);

              if (apiKey !== undefined) {
                const trimmedKey = apiKey.trim();
                if (trimmedKey) {
                  await providerService.setLegacyProviderApiKey(config.id, trimmedKey);
                }
              }

              try {
                await syncSavedProviderToRuntime(config, apiKey, gatewayManager);
              } catch (err) {
                console.warn('Failed to sync openclaw provider config:', err);
              }

              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'delete') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.delete payload');

            try {
              const existing = await providerService.getLegacyProvider(providerId);
              await providerService.deleteLegacyProvider(providerId);
              if (existing?.type) {
                try {
                  await syncDeletedProviderToRuntime(existing, providerId, gatewayManager);
                } catch (err) {
                  console.warn('Failed to completely remove provider from OpenClaw:', err);
                }
              }
              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'setApiKey') {
            const payload = request.payload as
              | { providerId?: string; apiKey?: string }
              | [string, string]
              | undefined;
            const providerId = Array.isArray(payload) ? payload[0] : payload?.providerId;
            const apiKey = Array.isArray(payload) ? payload[1] : payload?.apiKey;
            if (!providerId || typeof apiKey !== 'string')
              throw new Error('Invalid provider.setApiKey payload');

            try {
              await providerService.setLegacyProviderApiKey(providerId, apiKey);
              const provider = await providerService.getLegacyProvider(providerId);
              const providerType = provider?.type || providerId;
              const ock = getOpenClawProviderKey(providerType, providerId);
              try {
                await saveProviderKeyToOpenClaw(ock, apiKey);
              } catch (err) {
                console.warn('Failed to save key to OpenClaw auth-profiles:', err);
              }
              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'updateWithKey') {
            const payload = request.payload as
              | { providerId?: string; updates?: Partial<ProviderConfig>; apiKey?: string }
              | [string, Partial<ProviderConfig>, string?]
              | undefined;
            const providerId = Array.isArray(payload) ? payload[0] : payload?.providerId;
            const updates = Array.isArray(payload) ? payload[1] : payload?.updates;
            const apiKey = Array.isArray(payload) ? payload[2] : payload?.apiKey;
            if (!providerId || !updates) throw new Error('Invalid provider.updateWithKey payload');

            const existing = await providerService.getLegacyProvider(providerId);
            if (!existing) {
              data = { success: false, error: 'Provider not found' };
              break;
            }

            const previousKey = await providerService.getLegacyProviderApiKey(providerId);
            const previousOck = getOpenClawProviderKey(existing.type, providerId);

            try {
              const nextConfig: ProviderConfig = {
                ...existing,
                ...updates,
                updatedAt: new Date().toISOString(),
              };
              const ock = getOpenClawProviderKey(nextConfig.type, providerId);
              await providerService.saveLegacyProvider(nextConfig);

              if (apiKey !== undefined) {
                const trimmedKey = apiKey.trim();
                if (trimmedKey) {
                  await providerService.setLegacyProviderApiKey(providerId, trimmedKey);
                  await saveProviderKeyToOpenClaw(ock, trimmedKey);
                } else {
                  await providerService.deleteLegacyProviderApiKey(providerId);
                  await removeProviderFromOpenClaw(ock);
                }
              }

              try {
                await syncUpdatedProviderToRuntime(nextConfig, apiKey, gatewayManager);
              } catch (err) {
                console.warn('Failed to sync openclaw config after provider update:', err);
              }

              data = { success: true };
            } catch (error) {
              try {
                await providerService.saveLegacyProvider(existing);
                if (previousKey) {
                  await providerService.setLegacyProviderApiKey(providerId, previousKey);
                  await saveProviderKeyToOpenClaw(previousOck, previousKey);
                } else {
                  await providerService.deleteLegacyProviderApiKey(providerId);
                  await removeProviderFromOpenClaw(previousOck);
                }
              } catch (rollbackError) {
                console.warn('Failed to rollback provider updateWithKey:', rollbackError);
              }

              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'deleteApiKey') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.deleteApiKey payload');
            try {
              await providerService.deleteLegacyProviderApiKey(providerId);
              const provider = await providerService.getLegacyProvider(providerId);
              const providerType = provider?.type || providerId;
              const ock = getOpenClawProviderKey(providerType, providerId);
              try {
                if (ock) {
                  await removeProviderFromOpenClaw(ock);
                }
              } catch (err) {
                console.warn('Failed to completely remove provider from OpenClaw:', err);
              }
              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'setDefault') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.setDefault payload');

            try {
              await providerService.setDefaultLegacyProvider(providerId);
              const provider = await providerService.getLegacyProvider(providerId);
              if (provider) {
                try {
                  await syncDefaultProviderToRuntime(providerId, gatewayManager);
                } catch (err) {
                  console.warn('Failed to set OpenClaw default model:', err);
                }
              }

              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'UNSUPPORTED',
              message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
            },
          };
        }
        case 'update': {
          if (request.action === 'status') {
            data = appUpdater.getStatus();
            break;
          }
          if (request.action === 'version') {
            data = appUpdater.getCurrentVersion();
            break;
          }
          if (request.action === 'check') {
            try {
              await appUpdater.checkForUpdates();
              data = { success: true, status: appUpdater.getStatus() };
            } catch (error) {
              data = { success: false, error: String(error), status: appUpdater.getStatus() };
            }
            break;
          }
          if (request.action === 'download') {
            try {
              await appUpdater.downloadUpdate();
              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'install') {
            appUpdater.quitAndInstall();
            data = { success: true };
            break;
          }
          if (request.action === 'setChannel') {
            const payload = request.payload as
              | { channel?: 'stable' }
              | 'stable'
              | undefined;
            const channel = typeof payload === 'string' ? payload : payload?.channel;
            if (!channel) throw new Error('Invalid update.setChannel payload');
            appUpdater.setChannel(channel);
            data = { success: true };
            break;
          }
          if (request.action === 'setAutoDownload') {
            const payload = request.payload as { enable?: boolean } | boolean | undefined;
            const enable = typeof payload === 'boolean' ? payload : payload?.enable;
            if (typeof enable !== 'boolean')
              throw new Error('Invalid update.setAutoDownload payload');
            appUpdater.setAutoDownload(enable);
            data = { success: true };
            break;
          }
          if (request.action === 'cancelAutoInstall') {
            appUpdater.cancelAutoInstall();
            data = { success: true };
            break;
          }
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'UNSUPPORTED',
              message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
            },
          };
        }
        case 'cron': {
          if (request.action === 'list') {
            const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
            const jobs = (result as { jobs?: GatewayCronJob[] })?.jobs ?? [];
            data = jobs.map(transformCronJob);
            break;
          }
          if (request.action === 'create') {
            const payload = request.payload as
              | { input?: Record<string, unknown> }
              | [Record<string, unknown>]
              | Record<string, unknown>
              | undefined;
            let input: Record<string, unknown> | undefined;
            if (Array.isArray(payload)) {
              input = payload[0];
            } else if (payload && typeof payload === 'object' && 'input' in payload) {
              input = payload.input as Record<string, unknown> | undefined;
            } else {
              input = payload as Record<string, unknown> | undefined;
            }
            if (!input) throw new Error('Invalid cron.create payload');
            const created = await gatewayManager.rpc('cron.add', normalizeIncomingCronJob(input));
            data =
              created && typeof created === 'object'
                ? transformCronJob(created as GatewayCronJob)
                : created;
            break;
          }
          if (request.action === 'update') {
            const payload = request.payload as
              | { id?: string; input?: Record<string, unknown> }
              | [string, Record<string, unknown>]
              | undefined;
            const id = Array.isArray(payload) ? payload[0] : payload?.id;
            const input = Array.isArray(payload) ? payload[1] : payload?.input;
            if (!id || !input) throw new Error('Invalid cron.update payload');
            const patch = normalizeIncomingCronJob(input);
            data = await gatewayManager.rpc('cron.update', { id, patch });
            break;
          }
          if (request.action === 'delete') {
            const payload = request.payload as { id?: string } | string | undefined;
            const id = typeof payload === 'string' ? payload : payload?.id;
            if (!id) throw new Error('Invalid cron.delete payload');
            data = await gatewayManager.rpc('cron.remove', { id });
            break;
          }
          if (request.action === 'toggle') {
            const payload = request.payload as
              | { id?: string; enabled?: boolean }
              | [string, boolean]
              | undefined;
            const id = Array.isArray(payload) ? payload[0] : payload?.id;
            const enabled = Array.isArray(payload) ? payload[1] : payload?.enabled;
            if (!id || typeof enabled !== 'boolean') throw new Error('Invalid cron.toggle payload');
            data = await gatewayManager.rpc('cron.update', { id, patch: { enabled } });
            break;
          }
          if (request.action === 'trigger') {
            const payload = request.payload as { id?: string } | string | undefined;
            const id = typeof payload === 'string' ? payload : payload?.id;
            if (!id) throw new Error('Invalid cron.trigger payload');
            data = await gatewayManager.rpc('cron.run', { id, mode: 'force' });
            break;
          }
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'UNSUPPORTED',
              message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
            },
          };
        }
        case 'usage': {
          if (request.action === 'recentTokenHistory') {
            const payload = request.payload as { limit?: number } | number | undefined;
            const limit = typeof payload === 'number' ? payload : payload?.limit;
            const safeLimit =
              typeof limit === 'number' && Number.isFinite(limit)
                ? Math.max(Math.floor(limit), 1)
                : undefined;
            data = await getRecentTokenUsageHistory(safeLimit);
            break;
          }
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'UNSUPPORTED',
              message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
            },
          };
        }
        case 'settings': {
          if (request.action === 'getAll') {
            data = await getAllSettings();
            break;
          }
          if (request.action === 'get') {
            const payload = request.payload as
              | { key?: keyof AppSettings }
              | [keyof AppSettings]
              | undefined;
            const key = Array.isArray(payload) ? payload[0] : payload?.key;
            if (!key) throw new Error('Invalid settings.get payload');
            data = await getSetting(key);
            break;
          }
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'UNSUPPORTED',
              message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
            },
          };
        }
        default:
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'UNSUPPORTED',
              message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
            },
          };
      }

      return { id: request.id, ok: true, data };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        error: {
          code: mapAppErrorCode(error),
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
}

/**
 * Skill config IPC handlers
 * Direct read/write to ~/.openclaw/openclaw.json (bypasses Gateway RPC)
 */
function registerSkillConfigHandlers(): void {
  // Update skill config (apiKey and env)
  ipcMain.handle(
    'skill:updateConfig',
    async (
      _,
      params: {
        skillKey: string;
        apiKey?: string;
        env?: Record<string, string>;
      }
    ) => {
      return await updateSkillConfig(params.skillKey, {
        apiKey: params.apiKey,
        env: params.env,
      });
    }
  );

  // Get skill config
  ipcMain.handle('skill:getConfig', async (_, skillKey: string) => {
    return await getSkillConfig(skillKey);
  });

  // Get all skill configs
  ipcMain.handle('skill:getAllConfigs', async () => {
    return await getAllSkillConfigs();
  });
}

/**
 * Gateway CronJob type (as returned by cron.list RPC)
 */
interface GatewayCronJob {
  id: string;
  agentId?: string | null;
  sessionKey?: string | null;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: string; expr?: string; everyMs?: number; at?: string; tz?: string };
  wakeMode?: 'now' | 'next-heartbeat';
  payload: Record<string, unknown> & { kind: string; message?: string; text?: string };
  delivery?: Record<string, unknown> & { mode: string; channel?: string; to?: string };
  failureAlert?: unknown;
  sessionTarget?: string;
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
}

function isUiManagedAgentTurn(job: GatewayCronJob): boolean {
  return (
    (job.sessionTarget === 'isolated' || !job.sessionTarget)
    && job.payload?.kind === 'agentTurn'
    && (job.delivery?.mode ?? 'none') === 'none'
  );
}

async function getCronJobById(gatewayManager: GatewayManager, id: string): Promise<GatewayCronJob | undefined> {
  const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
  const data = result as { jobs?: GatewayCronJob[] };
  return (data?.jobs ?? []).find((job) => job.id === id);
}

function normalizeIncomingCronJob(input: Record<string, unknown>) {
  const patch = { ...input };
  if (typeof patch.schedule === 'string') {
    patch.schedule = { kind: 'cron', expr: patch.schedule };
  }
  if (typeof patch.message === 'string') {
    patch.payload = { kind: 'agentTurn', message: patch.message };
    delete patch.message;
  }
  return patch;
}

/**
 * Transform a Gateway CronJob to the frontend CronJob format
 */
function transformCronJob(job: GatewayCronJob) {
  const lastRun = job.state?.lastRunAtMs
    ? {
        time: new Date(job.state.lastRunAtMs).toISOString(),
        success: job.state.lastStatus === 'ok',
        error: job.state.lastError,
        duration: job.state.lastDurationMs,
      }
    : undefined;

  // Build nextRun from state
  const nextRun = job.state?.nextRunAtMs
    ? new Date(job.state.nextRunAtMs).toISOString()
    : undefined;

  return {
    id: job.id,
    agentId: job.agentId,
    sessionKey: job.sessionKey ?? null,
    name: job.name,
    description: job.description,
    deleteAfterRun: job.deleteAfterRun ?? false,
    schedule: job.schedule,
    enabled: job.enabled,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
    wakeMode: job.wakeMode ?? 'now',
    payload: job.payload,
    delivery: job.delivery,
    failureAlert: job.failureAlert,
    state: job.state,
    lastRun,
    nextRun,
    uiManaged: isUiManagedAgentTurn(job),
    sessionTarget: job.sessionTarget ?? 'isolated',
  };
}

/**
 * Cron task IPC handlers
 * Proxies cron operations to the Gateway RPC service.
 * The frontend works with plain cron expression strings, but the Gateway
 * expects CronSchedule objects ({ kind: "cron", expr: "..." }).
 * These handlers bridge the two formats.
 */
function registerCronHandlers(gatewayManager: GatewayManager): void {
  // List all cron jobs — transforms Gateway CronJob format to frontend CronJob format
  ipcMain.handle('cron:list', async () => {
    try {
      const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
      const data = result as { jobs?: GatewayCronJob[] };
      const jobs = data?.jobs ?? [];

      // Transform Gateway format to frontend format
      return jobs.map(transformCronJob);
    } catch (error) {
      console.error('Failed to list cron jobs:', error);
      throw error;
    }
  });

  // Create a new cron job
  // UI-created tasks have no delivery target — results go to the ClawClaw chat page.
  // Tasks created via external channels (Feishu, Discord, etc.) are handled
  // directly by the OpenClaw Gateway and do not pass through this IPC handler.
  ipcMain.handle(
    'cron:create',
    async (
      _,
      input: {
        name: string;
        message: string;
        schedule: string;
        enabled?: boolean;
      }
    ) => {
      try {
        const gatewayInput = {
          name: input.name,
          schedule: { kind: 'cron', expr: input.schedule },
          payload: { kind: 'agentTurn', message: input.message },
          enabled: input.enabled ?? true,
          wakeMode: 'next-heartbeat',
          sessionTarget: 'isolated',
          // UI-created reminder jobs should stay isolated, but still announce
          // back into the originating session so they are actually visible.
              delivery: { mode: 'none' },
            };
        const result = await gatewayManager.rpc('cron.add', gatewayInput);
        // Transform the returned job to frontend format
        if (result && typeof result === 'object') {
          return transformCronJob(result as GatewayCronJob);
        }
        return result;
      } catch (error) {
        console.error('Failed to create cron job:', error);
        throw error;
      }
    }
  );

  // Update an existing cron job
  ipcMain.handle('cron:update', async (_, id: string, input: Record<string, unknown>) => {
    try {
      // Transform schedule string to CronSchedule object if present
      const patch = { ...input };
      if (typeof patch.schedule === 'string') {
        patch.schedule = { kind: 'cron', expr: patch.schedule };
      }
      // Transform message to payload format if present
      if (typeof patch.message === 'string') {
        patch.payload = { kind: 'agentTurn', message: patch.message };
        delete patch.message;
      }
      const current = await getCronJobById(gatewayManager, id);
      if (current && isEditableUiJob(current)) {
        patch.delivery = { mode: current.delivery?.mode ?? 'none' };
      }
      const result = await gatewayManager.rpc('cron.update', { id, patch });
      return result;
    } catch (error) {
      console.error('Failed to update cron job:', error);
      throw error;
    }
  });

  // Delete a cron job
  ipcMain.handle('cron:delete', async (_, id: string) => {
    try {
      const result = await gatewayManager.rpc('cron.remove', { id });
      return result;
    } catch (error) {
      console.error('Failed to delete cron job:', error);
      throw error;
    }
  });

  // Toggle a cron job enabled/disabled
  ipcMain.handle('cron:toggle', async (_, id: string, enabled: boolean) => {
    try {
      const result = await gatewayManager.rpc('cron.update', { id, patch: { enabled } });
      return result;
    } catch (error) {
      console.error('Failed to toggle cron job:', error);
      throw error;
    }
  });

  // Trigger a cron job manually
  ipcMain.handle('cron:trigger', async (_, id: string) => {
    try {
      const result = await gatewayManager.rpc('cron.run', { id, mode: 'force' });
      return result;
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      throw error;
    }
  });
}

/**
 * UV-related IPC handlers
 */
function registerUvHandlers(): void {
  // Check if uv is installed
  ipcMain.handle('uv:check', async () => {
    return await checkUvInstalled();
  });

  // Install uv and setup managed Python
  ipcMain.handle('uv:install-all', async () => {
    try {
      const isInstalled = await checkUvInstalled();
      if (!isInstalled) {
        await installUv();
      }
      // Always run python setup to ensure it exists in uv's cache
      await setupManagedPython();
      return { success: true };
    } catch (error) {
      console.error('Failed to setup uv/python:', error);
      return { success: false, error: String(error) };
    }
  });
}

/**
 * Log-related IPC handlers
 * Allows the renderer to read application logs for diagnostics
 */
function registerLogHandlers(): void {
  // Get recent logs from memory ring buffer
  ipcMain.handle('log:getRecent', async (_, count?: number) => {
    return logger.getRecentLogs(count);
  });

  // Read log file content (last N lines)
  ipcMain.handle('log:readFile', async (_, tailLines?: number) => {
    return await logger.readLogFile(tailLines);
  });

  // Get log file path (so user can open in file explorer)
  ipcMain.handle('log:getFilePath', async () => {
    return logger.getLogFilePath();
  });

  // Get log directory path
  ipcMain.handle('log:getDir', async () => {
    return logger.getLogDir();
  });

  // List all log files
  ipcMain.handle('log:listFiles', async () => {
    return await logger.listLogFiles();
  });
}

/**
 * Gateway-related IPC handlers
 */
function registerGatewayHandlers(gatewayManager: GatewayManager, mainWindow: BrowserWindow): void {
  const emitGatewayLifecycle = (payload: {
    phase: 'scheduled' | 'completed' | 'failed';
    action: 'start' | 'restart' | 'reload';
    source: string;
    reason: string;
    error?: string;
    delayMs?: number;
    recovery?: GatewayConfigRecovery;
  }) => {
    const event = {
      ...payload,
      at: Date.now(),
    };
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:lifecycle-changed', event);
    }
  };

  const resolveGatewayStatus = async () => {
    const status = gatewayManager.getStatus();
    if (
      (status.state === 'stopped' || status.state === 'error')
      && !gatewayManager.isConnected()
      && !gatewayManager.isStartInProgress()
    ) {
      try {
        await gatewayManager.attachIfRunning();
      } catch {
        // Ignore attach probe failures and fall back to the last known status.
      }
    }
    return gatewayManager.getStatus();
  };

  type GatewayHttpProxyRequest = {
    path?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  };

  // Get Gateway status
  ipcMain.handle('gateway:status', async () => {
    return await resolveGatewayStatus();
  });

  // Check if Gateway is connected
  ipcMain.handle('gateway:isConnected', () => {
    return gatewayManager.isConnected();
  });

  // Start Gateway
  ipcMain.handle('gateway:start', async () => {
    try {
      await gatewayManager.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Stop Gateway
  ipcMain.handle('gateway:stop', async () => {
    try {
      await gatewayManager.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Restart Gateway — force=true so it always stops/starts immediately regardless
  // of startup lock, governor cooldown, or deferred-restart queue.
  ipcMain.handle('gateway:restart', async () => {
    try {
      emitGatewayLifecycle({
        phase: 'scheduled',
        action: 'restart',
        source: 'gateway.manualRestart',
        reason: 'gateway.manualRestart',
      });
      void gatewayManager.restart({ force: true }).catch((error) => {
        emitGatewayLifecycle({
          phase: 'failed',
          action: 'restart',
          source: 'gateway.manualRestart',
          reason: 'gateway.manualRestart',
          error: String(error),
        });
      });
      return { success: true, accepted: true };
    } catch (error) {
      emitGatewayLifecycle({
        phase: 'failed',
        action: 'restart',
        source: 'gateway.manualRestart',
        reason: 'gateway.manualRestart',
        error: String(error),
      });
      return { success: false, error: String(error) };
    }
  });

  // Scan ports 18789–18799 for all running OpenClaw Gateway instances.
  ipcMain.handle('gateway:scanPorts', async () => {
    const { scanGatewayPorts } = await import('../gateway/supervisor');
    return await scanGatewayPorts();
  });

  // Kill the gateway process listening on a specific port.
  // Resets the restart governor so the local instance can restart cleanly.
  ipcMain.handle('gateway:killPort', async (_, port: number) => {
    const { killGatewayOnPort } = await import('../gateway/supervisor');
    return await killGatewayOnPort(port, gatewayManager);
  });

  // Gateway RPC call
  ipcMain.handle('gateway:rpc', async (_, method: string, params?: unknown, timeoutMs?: number) => {
    try {
      const result = await gatewayManager.rpc(method, params, timeoutMs);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Gateway HTTP proxy
  // Renderer must not call gateway HTTP directly (CORS); all HTTP traffic
  // should go through this main-process proxy.
  ipcMain.handle('gateway:httpProxy', async (_, request: GatewayHttpProxyRequest) => {
    try {
      const status = gatewayManager.getStatus();
      const port = status.port || 18789;
      const path = request?.path && request.path.startsWith('/') ? request.path : '/';
      const method = (request?.method || 'GET').toUpperCase();
      const timeoutMs =
        typeof request?.timeoutMs === 'number' && request.timeoutMs > 0 ? request.timeoutMs : 15000;

      const token = await getSetting('gatewayToken');
      const headers: Record<string, string> = {
        ...(request?.headers ?? {}),
      };
      if (!headers.Authorization && !headers.authorization && token) {
        headers.Authorization = `Bearer ${token}`;
      }

      let body: string | undefined;
      if (request?.body !== undefined && request?.body !== null) {
        body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await proxyAwareFetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        const json = await response.json();
        return {
          success: true,
          status: response.status,
          ok: response.ok,
          json,
        };
      }

      const text = await response.text();
      return {
        success: true,
        status: response.status,
        ok: response.ok,
        text,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  });

  // Chat send with media — reads staged files from disk and builds attachments.
  // Raster images (png/jpg/gif/webp) are inlined as base64 vision attachments.
  // All other files are referenced by path in the message text so the model
  // can access them via tools (the same format channels use).
  const VISION_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/bmp', 'image/webp']);

  ipcMain.handle(
    'chat:sendWithMedia',
    async (
      _,
      params: {
        sessionKey: string;
        message: string;
        deliver?: boolean;
        idempotencyKey: string;
        media?: Array<{ filePath: string; mimeType: string; fileName: string }>;
      }
    ) => {
      try {
        let message = params.message;
        // The Gateway processes image attachments through TWO parallel paths:
        // Path A: `attachments` param → parsed via `parseMessageWithAttachments` →
        //   injected as inline vision content when the model supports images.
        //   Format: { content: base64, mimeType: string, fileName?: string }
        // Path B: `[media attached: ...]` in message text → Gateway's native image
        //   detection (`detectAndLoadPromptImages`) reads the file from disk and
        //   injects it as inline vision content. Also works for history messages.
        // We use BOTH paths for maximum reliability.
        const imageAttachments: Array<Record<string, unknown>> = [];
        const fileReferences: string[] = [];

        if (params.media && params.media.length > 0) {
          const fsP = await import('fs/promises');
          for (const m of params.media) {
            const exists = await fsP.access(m.filePath).then(
              () => true,
              () => false
            );
            logger.info(
              `[chat:sendWithMedia] Processing file: ${m.fileName} (${m.mimeType}), path: ${m.filePath}, exists: ${exists}, isVision: ${VISION_MIME_TYPES.has(m.mimeType)}`
            );

            // Always add file path reference so the model can access it via tools
            fileReferences.push(`[media attached: ${m.filePath} (${m.mimeType}) | ${m.filePath}]`);

            if (VISION_MIME_TYPES.has(m.mimeType)) {
              // Send as base64 attachment in the format the Gateway expects:
              // { content: base64String, mimeType: string, fileName?: string }
              // The Gateway normalizer looks for `a.content` (NOT `a.source.data`).
              const fileBuffer = await fsP.readFile(m.filePath);
              const base64Data = fileBuffer.toString('base64');
              logger.info(
                `[chat:sendWithMedia] Read ${fileBuffer.length} bytes, base64 length: ${base64Data.length}`
              );
              imageAttachments.push({
                content: base64Data,
                mimeType: m.mimeType,
                fileName: m.fileName,
              });
            }
          }
        }

        // Append file references to message text so the model knows about them
        if (fileReferences.length > 0) {
          const refs = fileReferences.join('\n');
          message = message ? `${message}\n\n${refs}` : refs;
        }

        const rpcParams: Record<string, unknown> = {
          sessionKey: params.sessionKey,
          message,
          deliver: params.deliver ?? false,
          idempotencyKey: params.idempotencyKey,
        };

        if (imageAttachments.length > 0) {
          rpcParams.attachments = imageAttachments;
        }

        logger.info(
          `[chat:sendWithMedia] Sending: message="${message.substring(0, 100)}", attachments=${imageAttachments.length}, fileRefs=${fileReferences.length}`
        );

        // Longer timeout for chat sends to tolerate high-latency networks (avoids connect error)
        const timeoutMs = 120000;
        const result = await gatewayManager.rpc('chat.send', rpcParams, timeoutMs);
        logger.info(`[chat:sendWithMedia] RPC result: ${JSON.stringify(result)}`);
        return { success: true, result };
      } catch (error) {
        logger.error(`[chat:sendWithMedia] Error: ${String(error)}`);
        return { success: false, error: String(error) };
      }
    }
  );

  // Get the Control UI URL with token for embedding
  ipcMain.handle('gateway:getControlUiUrl', async () => {
    try {
      const status = gatewayManager.getStatus();
      const token = await getSetting('gatewayToken');
      const port = status.port || 18789;
      // Pass token as query param - Control UI will store it in localStorage
      const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
      return { success: true, url, port, token };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Health check
  ipcMain.handle('gateway:health', async () => {
    try {
      const health = await gatewayManager.checkHealth();
      return { success: true, ...health };
    } catch (error) {
      return { success: false, ok: false, error: String(error) };
    }
  });

  // Forward Gateway events to renderer
  gatewayManager.on('status', (status) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:status-changed', status);
    }
  });

  gatewayManager.on('message', (message) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:message', message);
    }
  });

  gatewayManager.on('notification', (notification) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:notification', notification);
    }
  });

  gatewayManager.on('channel:status', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:channel-status', data);
    }
  });

  gatewayManager.on('chat:message', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:chat-message', data);
    }
  });

  gatewayManager.on('exit', (code) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:exit', code);
    }
  });

  gatewayManager.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:error', error.message);
    }
  });
}

/**
 * OpenClaw-related IPC handlers
 * For checking package status and local OpenClaw paths
 */
function registerOpenClawHandlers(): void {
  // Get OpenClaw package status
  ipcMain.handle('openclaw:status', () => {
    const status = getOpenClawStatus();
    logger.info('openclaw:status IPC called', status);
    return status;
  });

  // Check if OpenClaw is ready (package present)
  ipcMain.handle('openclaw:isReady', () => {
    const status = getOpenClawStatus();
    return status.packageExists;
  });

  // Get the resolved OpenClaw directory path (for diagnostics)
  ipcMain.handle('openclaw:getDir', () => {
    return getOpenClawDir();
  });

  // Get the OpenClaw config directory (~/.openclaw)
  ipcMain.handle('openclaw:getConfigDir', () => {
    return getOpenClawConfigDir();
  });

  // Get the OpenClaw managed skills directory (~/.openclaw/skills) or a workspace skills directory.
  ipcMain.handle('openclaw:getSkillsDir', (_event, params?: { workspaceDir?: string }) => {
    const workspaceDir =
      typeof params?.workspaceDir === 'string' && params.workspaceDir.trim().length > 0
        ? params.workspaceDir.trim()
        : null;
    const dir = workspaceDir ? resolve(workspaceDir, 'skills') : getOpenClawSkillsDir();
    ensureDir(dir);
    return dir;
  });


  // Get a shell command to run OpenClaw CLI without modifying PATH
  ipcMain.handle('openclaw:getCliCommand', () => {
    try {
      const status = getOpenClawStatus();
      if (!status.packageExists) {
        return { success: false, error: `OpenClaw package not found at: ${status.dir}` };
      }
      if (!existsSync(status.entryPath)) {
        return { success: false, error: `OpenClaw entry script not found at: ${status.entryPath}` };
      }
      return { success: true, command: getOpenClawCliCommand() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}

/**
 * WhatsApp Login Handlers
 */
function registerWhatsAppHandlers(mainWindow: BrowserWindow): void {
  // Request WhatsApp QR code
  ipcMain.handle('channel:requestWhatsAppQr', async (_, accountId: string) => {
    try {
      logger.info('channel:requestWhatsAppQr', { accountId });
      await whatsAppLoginManager.start(accountId);
      return { success: true };
    } catch (error) {
      logger.error('channel:requestWhatsAppQr failed', error);
      return { success: false, error: String(error) };
    }
  });

  // Cancel WhatsApp login
  ipcMain.handle('channel:cancelWhatsAppQr', async () => {
    try {
      await whatsAppLoginManager.stop();
      return { success: true };
    } catch (error) {
      logger.error('channel:cancelWhatsAppQr failed', error);
      return { success: false, error: String(error) };
    }
  });

  // Check WhatsApp status (is it active?)
  // ipcMain.handle('channel:checkWhatsAppStatus', ...)

  // Forward events to renderer
  whatsAppLoginManager.on('qr', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('channel:whatsapp-qr', data);
    }
  });

  whatsAppLoginManager.on('success', (data) => {
    if (!mainWindow.isDestroyed()) {
      logger.info('whatsapp:login-success', data);
      mainWindow.webContents.send('channel:whatsapp-success', data);
    }
  });

  whatsAppLoginManager.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      logger.error('whatsapp:login-error', error);
      mainWindow.webContents.send('channel:whatsapp-error', error);
    }
  });

}

/**
 * Device OAuth Handlers (Code Plan)
 */
function registerDeviceOAuthHandlers(mainWindow: BrowserWindow): void {
  deviceOAuthManager.setWindow(mainWindow);
  browserOAuthManager.setWindow(mainWindow);

  // Request Provider OAuth initialization
  ipcMain.handle(
    'provider:requestOAuth',
    async (
      _,
      provider: OAuthProviderType | BrowserOAuthProviderType,
      region?: 'global' | 'cn',
      options?: { accountId?: string; label?: string }
    ) => {
      try {
        logger.info(`provider:requestOAuth for ${provider}`);
        if (provider === 'google') {
          void browserOAuthManager.startFlow(provider, options).catch((error) => {
            logger.error('provider:requestOAuth browser flow failed', error);
          });
        } else {
          void deviceOAuthManager.startFlow(provider, region, options).catch((error) => {
            logger.error('provider:requestOAuth device flow failed', error);
          });
        }
        return { success: true };
      } catch (error) {
        logger.error('provider:requestOAuth failed', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Cancel Provider OAuth
  ipcMain.handle('provider:cancelOAuth', async () => {
    try {
      await deviceOAuthManager.stopFlow();
      await browserOAuthManager.stopFlow();
      return { success: true };
    } catch (error) {
      logger.error('provider:cancelOAuth failed', error);
      return { success: false, error: String(error) };
    }
  });
}

/**
 * Provider-related IPC handlers
 */
function registerProviderHandlers(gatewayManager: GatewayManager): void {
  const providerService = getProviderService();
  const legacyProviderChannelsWarned = new Set<string>();
  const logLegacyProviderChannel = (channel: string): void => {
    if (legacyProviderChannelsWarned.has(channel)) return;
    legacyProviderChannelsWarned.add(channel);
    logger.warn(
      `[provider-migration] Legacy IPC channel "${channel}" is deprecated. Prefer app:request provider actions and account APIs.`
    );
  };

  // provider:setDefault already schedules a restart (via syncSavedProviderToRuntime →
  // scheduleGatewayRefresh) which writes the OAuth token to config synchronously before
  // the restart fires. The setDefault restart therefore always picks up the new token.
  // No additional restart is needed here; scheduling one would only waste the governor's
  // restart budget and risk cascading conflicts with nearby provider operations.
  deviceOAuthManager.on('oauth:success', ({ provider, accountId }) => {
    logger.debug(
      `[IPC] OAuth token saved by provider:setDefault; no separate Gateway restart needed (provider=${provider}, accountId=${accountId})`
    );
  });
  browserOAuthManager.on('oauth:success', ({ provider, accountId }) => {
    logger.debug(
      `[IPC] OAuth token saved by provider:setDefault; no separate Gateway restart needed (provider=${provider}, accountId=${accountId})`
    );
  });

  // Get all providers with key info
  ipcMain.handle('provider:list', async () => {
    logLegacyProviderChannel('provider:list');
    return await providerService.listLegacyProvidersWithKeyInfo();
  });

  // New provider-service endpoints used by the account-based refactor.
  ipcMain.handle('provider:listVendors', async () => {
    return await providerService.listVendors();
  });

  ipcMain.handle('provider:listAccounts', async () => {
    return await providerService.listAccounts();
  });

  ipcMain.handle('provider:getAccount', async (_, accountId: string) => {
    return await providerService.getAccount(accountId);
  });

  // Get a specific provider
  ipcMain.handle('provider:get', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:get');
    return await providerService.getLegacyProvider(providerId);
  });

  // Save a provider configuration
  ipcMain.handle('provider:save', async (_, config: ProviderConfig, apiKey?: string) => {
    logLegacyProviderChannel('provider:save');
    try {
      // Save the provider config
      await providerService.saveLegacyProvider(config);

      // Store the API key if provided
      if (apiKey !== undefined) {
        const trimmedKey = apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(config.id, trimmedKey);

          // Also write to OpenClaw auth-profiles.json so the gateway can use it
          try {
            await syncProviderApiKeyToRuntime(config.type, config.id, trimmedKey);
          } catch (err) {
            console.warn('Failed to save key to OpenClaw auth-profiles:', err);
          }
        }
      }

      // Sync the provider configuration to openclaw.json so Gateway knows about it
      try {
        await syncSavedProviderToRuntime(config, apiKey, gatewayManager);
      } catch (err) {
        console.warn('Failed to sync openclaw provider config:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Delete a provider
  ipcMain.handle('provider:delete', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:delete');
    try {
      const existing = await providerService.getLegacyProvider(providerId);
      await providerService.deleteLegacyProvider(providerId);

      // Best-effort cleanup in OpenClaw auth profiles & openclaw.json config
      if (existing?.type) {
        try {
          await syncDeletedProviderToRuntime(existing, providerId, gatewayManager);
        } catch (err) {
          console.warn('Failed to completely remove provider from OpenClaw:', err);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Update API key for a provider
  ipcMain.handle('provider:setApiKey', async (_, providerId: string, apiKey: string) => {
    logLegacyProviderChannel('provider:setApiKey');
    try {
      await providerService.setLegacyProviderApiKey(providerId, apiKey);

      // Also write to OpenClaw auth-profiles.json
      const provider = await providerService.getLegacyProvider(providerId);
      const providerType = provider?.type || providerId;
      try {
        await syncProviderApiKeyToRuntime(providerType, providerId, apiKey);
      } catch (err) {
        console.warn('Failed to save key to OpenClaw auth-profiles:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Atomically update provider config and API key
  ipcMain.handle(
    'provider:updateWithKey',
    async (_, providerId: string, updates: Partial<ProviderConfig>, apiKey?: string) => {
      logLegacyProviderChannel('provider:updateWithKey');
      const existing = await providerService.getLegacyProvider(providerId);
      if (!existing) {
        return { success: false, error: 'Provider not found' };
      }

      const previousKey = await providerService.getLegacyProviderApiKey(providerId);
      const previousOck = getOpenClawProviderKey(existing.type, providerId);

      try {
        const nextConfig: ProviderConfig = {
          ...existing,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        const ock = getOpenClawProviderKey(nextConfig.type, providerId);

        await providerService.saveLegacyProvider(nextConfig);

        if (apiKey !== undefined) {
          const trimmedKey = apiKey.trim();
          if (trimmedKey) {
            await providerService.setLegacyProviderApiKey(providerId, trimmedKey);
            await syncProviderApiKeyToRuntime(nextConfig.type, providerId, trimmedKey);
          } else {
            await providerService.deleteLegacyProviderApiKey(providerId);
            await removeProviderFromOpenClaw(ock);
          }
        }

        // Sync the provider configuration to openclaw.json so Gateway knows about it
        try {
          await syncUpdatedProviderToRuntime(nextConfig, apiKey, gatewayManager);
        } catch (err) {
          console.warn('Failed to sync openclaw config after provider update:', err);
        }

        return { success: true };
      } catch (error) {
        // Best-effort rollback to keep config/key consistent.
        try {
          await providerService.saveLegacyProvider(existing);
          if (previousKey) {
            await providerService.setLegacyProviderApiKey(providerId, previousKey);
            await saveProviderKeyToOpenClaw(previousOck, previousKey);
          } else {
            await providerService.deleteLegacyProviderApiKey(providerId);
            await removeProviderFromOpenClaw(previousOck);
          }
        } catch (rollbackError) {
          console.warn('Failed to rollback provider updateWithKey:', rollbackError);
        }

        return { success: false, error: String(error) };
      }
    }
  );

  // Delete API key for a provider
  ipcMain.handle('provider:deleteApiKey', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:deleteApiKey');
    try {
      await providerService.deleteLegacyProviderApiKey(providerId);

      // Keep OpenClaw auth-profiles.json in sync with local key storage
      const provider = await providerService.getLegacyProvider(providerId);
      try {
        await syncDeletedProviderApiKeyToRuntime(provider, providerId);
      } catch (err) {
        console.warn('Failed to completely remove provider from OpenClaw:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Check if a provider has an API key
  ipcMain.handle('provider:hasApiKey', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:hasApiKey');
    return await providerService.hasLegacyProviderApiKey(providerId);
  });

  // Get the actual API key (for internal use only - be careful!)
  ipcMain.handle('provider:getApiKey', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:getApiKey');
    return await providerService.getLegacyProviderApiKey(providerId);
  });

  // Set default provider and update OpenClaw default model
  ipcMain.handle('provider:setDefault', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:setDefault');
    try {
      await providerService.setDefaultLegacyProvider(providerId);

      // Update OpenClaw config to use this provider's default model
      try {
        await syncDefaultProviderToRuntime(providerId, gatewayManager);
      } catch (err) {
        console.warn('Failed to set OpenClaw default model:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get default provider
  ipcMain.handle('provider:getDefault', async () => {
    logLegacyProviderChannel('provider:getDefault');
    return await providerService.getDefaultLegacyProvider();
  });

  // Validate API key by making a real test request to the provider.
  // providerId can be either a stored provider ID or a provider type.
  ipcMain.handle(
    'provider:validateKey',
    async (_, providerId: string, apiKey: string, options?: { baseUrl?: string }) => {
      logLegacyProviderChannel('provider:validateKey');
      try {
        // First try to get existing provider
        const provider = await providerService.getLegacyProvider(providerId);

        // Use provider.type if provider exists, otherwise use providerId as the type
        // This allows validation during setup when provider hasn't been saved yet
        const providerType = provider?.type || providerId;
        const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
        // Prefer caller-supplied baseUrl (live form value) over persisted config.
        // This ensures Setup/Settings validation reflects unsaved edits immediately.
        const resolvedBaseUrl = options?.baseUrl || provider?.baseUrl || registryBaseUrl;

        console.log(`[clawclaw-validate] validating provider type: ${providerType}`);
        return await validateApiKeyWithProvider(providerType, apiKey, { baseUrl: resolvedBaseUrl });
      } catch (error) {
        console.error('Validation error:', error);
        return { valid: false, error: String(error) };
      }
    }
  );
}

/**
 * Shell-related IPC handlers
 */
function registerShellHandlers(): void {
  // Open external URL
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url);
  });

  // Open path in file explorer
  ipcMain.handle('shell:showItemInFolder', async (_, path: string) => {
    shell.showItemInFolder(path);
  });

  // Open path
  ipcMain.handle('shell:openPath', async (_, path: string) => {
    const rawPath = typeof path === 'string' ? path.trim() : '';
    if (!rawPath) {
      return 'Path is empty';
    }

    const normalizedPath = resolve(expandPath(rawPath));
    if (!existsSync(normalizedPath)) {
      return `Path not found: ${normalizedPath}`;
    }

    return await shell.openPath(normalizedPath);
  });
}

/**
 * ClawHub-related IPC handlers
 */
function registerClawHubHandlers(clawHubService: ClawHubService): void {
  // Search skills
  ipcMain.handle('clawhub:search', async (_, params: ClawHubSearchParams) => {
    try {
      const results = await clawHubService.search(params);
      return { success: true, results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Install skill
  ipcMain.handle('clawhub:install', async (_, params: ClawHubInstallParams) => {
    try {
      await clawHubService.install(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Uninstall skill
  ipcMain.handle('clawhub:uninstall', async (_, params: ClawHubUninstallParams) => {
    try {
      await clawHubService.uninstall(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List installed skills
  ipcMain.handle('clawhub:list', async () => {
    try {
      const results = await clawHubService.listInstalled();
      return { success: true, results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Open skill readme
  ipcMain.handle('clawhub:openSkillReadme', async (_, slug: string) => {
    try {
      await clawHubService.openSkillReadme(slug);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}

/**
 * Dialog-related IPC handlers
 */
function registerDialogHandlers(): void {
  // Show open dialog
  ipcMain.handle('dialog:open', async (_, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(options);
    return result;
  });

  // Show save dialog
  ipcMain.handle('dialog:save', async (_, options: Electron.SaveDialogOptions) => {
    const nextOptions = { ...options };
    if (!nextOptions.defaultPath) {
      const exportDir = getDefaultExportDir('general');
      ensureDir(exportDir);
      nextOptions.defaultPath = exportDir;
    }
    const result = await dialog.showSaveDialog(nextOptions);
    return result;
  });

  // Show message box
  ipcMain.handle('dialog:message', async (_, options: Electron.MessageBoxOptions) => {
    const result = await dialog.showMessageBox(options);
    return result;
  });
}

/**
 * App-related IPC handlers
 */
function registerAppHandlers(): void {
  // Get app version
  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  // Get app name
  ipcMain.handle('app:name', () => {
    return app.getName();
  });

  // Get app path — portable-aware overrides for user-facing paths
  ipcMain.handle('app:getPath', (_, name: Parameters<typeof app.getPath>[0]) => {
    if (name === 'userData') return getDataDir();
    if (name === 'logs') return getLogsDir();
    if (name === 'home') return getOpenClawConfigDir(); // maps to .openclaw for renderer
    return app.getPath(name);
  });

  // Get platform
  ipcMain.handle('app:isPortable', () => {
    return getPortableDataDir() !== null;
  });

  ipcMain.handle('app:platform', () => {
    return process.platform;
  });

  // Quit app
  ipcMain.handle('app:quit', () => {
    quitApp(app);
  });

  // Relaunch app
  ipcMain.handle('app:relaunch', () => {
    relaunchApp(app);
  });
}

function registerSettingsHandlers(gatewayManager: GatewayManager): void {
  void gatewayManager;

  ipcMain.handle('settings:get', async (_, key: keyof AppSettings) => {
    return await getSetting(key);
  });

  ipcMain.handle('settings:getAll', async () => {
    return await getAllSettings();
  });

}
function registerUsageHandlers(): void {
  ipcMain.handle('usage:recentTokenHistory', async (_, limit?: number) => {
    const safeLimit =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.max(Math.floor(limit), 1)
        : undefined;
    return await getRecentTokenUsageHistory(safeLimit);
  });
}
/**
 * Window control handlers (for custom title bar on Windows/Linux)
 */
function registerWindowHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('window:minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    mainWindow.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow.isMaximized();
  });
}

// ── Mime type helpers ────────────────────────────────────────────

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function getMimeType(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

function mimeToExt(mimeType: string): string {
  for (const [ext, mime] of Object.entries(EXT_MIME_MAP)) {
    if (mime === mimeType) return ext;
  }
  return '';
}

const OUTBOUND_DIR = join(resolveOpenClawDir(), 'media', 'outbound');

/**
 * Generate a preview data URL for image files.
 * Resizes large images while preserving aspect ratio (only constrain the
 * longer side so the image is never squished). The frontend handles
 * square cropping via CSS object-fit: cover.
 */
async function generateImagePreview(filePath: string, mimeType: string): Promise<string | null> {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512; // keep enough resolution for crisp display on Retina
    // Only resize if larger than threshold — specify ONE dimension to keep ratio
    if (size.width > maxDim || size.height > maxDim) {
      const resized =
        size.width >= size.height
          ? img.resize({ width: maxDim }) // landscape / square → constrain width
          : img.resize({ height: maxDim }); // portrait → constrain height
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    // Small image — use original (async read to avoid blocking)
    const { readFile: readFileAsync } = await import('fs/promises');
    const buf = await readFileAsync(filePath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * File staging IPC handlers
 * Stage files to ~/.openclaw/media/outbound/ for gateway access
 */
function registerFileHandlers(): void {
  // Stage files from real disk paths (used with dialog:open)
  ipcMain.handle('file:stage', async (_, filePaths: string[]) => {
    const fsP = await import('fs/promises');
    await fsP.mkdir(OUTBOUND_DIR, { recursive: true });

    const results = [];
    for (const filePath of filePaths) {
      const id = crypto.randomUUID();
      const ext = extname(filePath);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      await fsP.copyFile(filePath, stagedPath);

      const s = await fsP.stat(stagedPath);
      const mimeType = getMimeType(ext);
      const fileName = basename(filePath);

      // Generate preview for images
      let preview: string | null = null;
      if (mimeType.startsWith('image/')) {
        preview = await generateImagePreview(stagedPath, mimeType);
      }

      results.push({ id, fileName, mimeType, fileSize: s.size, stagedPath, preview });
    }
    return results;
  });

  // Stage file from buffer (used for clipboard paste / drag-drop)
  ipcMain.handle(
    'file:stageBuffer',
    async (
      _,
      payload: {
        base64: string;
        fileName: string;
        mimeType: string;
      }
    ) => {
      const fsP = await import('fs/promises');
      await fsP.mkdir(OUTBOUND_DIR, { recursive: true });

      const id = crypto.randomUUID();
      const ext = extname(payload.fileName) || mimeToExt(payload.mimeType);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      const buffer = Buffer.from(payload.base64, 'base64');
      await fsP.writeFile(stagedPath, buffer);

      const mimeType = payload.mimeType || getMimeType(ext);
      const fileSize = buffer.length;

      // Generate preview for images
      let preview: string | null = null;
      if (mimeType.startsWith('image/')) {
        preview = await generateImagePreview(stagedPath, mimeType);
      }

      return { id, fileName: payload.fileName, mimeType, fileSize, stagedPath, preview };
    }
  );

  // Load thumbnails for file paths on disk (used to restore previews in history)
  // Save an image to a user-chosen location (base64 data URI or existing file path)
  ipcMain.handle(
    'media:saveImage',
    async (
      _,
      params: {
        base64?: string;
        mimeType?: string;
        filePath?: string;
        defaultFileName: string;
      }
    ) => {
      try {
        const ext = params.defaultFileName.includes('.')
          ? params.defaultFileName.split('.').pop()!
          : params.mimeType?.split('/')[1] || 'png';
        const exportDir = getDefaultExportDir('images');
        ensureDir(exportDir);
        const result = await dialog.showSaveDialog({
          defaultPath: join(exportDir, params.defaultFileName),
          filters: [
            { name: 'Images', extensions: [ext, 'png', 'jpg', 'jpeg', 'webp', 'gif'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
        if (result.canceled || !result.filePath) return { success: false };

        const fsP = await import('fs/promises');
        if (params.filePath) {
          try {
            await fsP.access(params.filePath);
            await fsP.copyFile(params.filePath, result.filePath);
          } catch {
            return { success: false, error: 'Source file not found' };
          }
        } else if (params.base64) {
          const buffer = Buffer.from(params.base64, 'base64');
          await fsP.writeFile(result.filePath, buffer);
        } else {
          return { success: false, error: 'No image data provided' };
        }
        return { success: true, savedPath: result.filePath };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
  );

  ipcMain.handle(
    'media:getThumbnails',
    async (_, paths: Array<{ filePath: string; mimeType: string }>) => {
      const fsP = await import('fs/promises');
      const results: Record<string, { preview: string | null; fileSize: number }> = {};
      for (const { filePath, mimeType } of paths) {
        try {
          const s = await fsP.stat(filePath);
          let preview: string | null = null;
          if (mimeType.startsWith('image/')) {
            preview = await generateImagePreview(filePath, mimeType);
          }
          results[filePath] = { preview, fileSize: s.size };
        } catch {
          results[filePath] = { preview: null, fileSize: 0 };
        }
      }
      return results;
    }
  );
}

/**
 * Session IPC handlers
 *
 * Session lifecycle must go through the Gateway so runtime cleanup and transcript
 * deletion stay aligned with OpenClaw's authoritative session model.
 */
function registerSessionHandlers(gatewayManager: GatewayManager): void {
  ipcMain.handle('session:delete', async (_, sessionKey: string) => {
    try {
      const normalizedKey = typeof sessionKey === 'string' ? sessionKey.trim() : '';
      if (!normalizedKey) {
        return { success: false, error: 'sessionKey is required' };
      }
      const result = await gatewayManager.rpc('sessions.delete', {
        key: normalizedKey,
        deleteTranscript: true,
      });
      logger.info(`[session:delete] deleted session via gateway: ${normalizedKey}`);
      return { success: true, result };
    } catch (err) {
      logger.error(`[session:delete] Unexpected error for ${sessionKey}:`, err);
      return { success: false, error: String(err) };
    }
  });
}
import type { GatewayConfigRecovery } from '../../src/types/gateway';
