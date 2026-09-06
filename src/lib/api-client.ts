import { trackUiEvent } from './telemetry';
import { AppError, type AppErrorCode, mapBackendErrorCode, normalizeAppError } from './error-model';
export { AppError } from './error-model';

type UnifiedRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
};

type UnifiedResponse = {
  id?: string;
  ok: boolean;
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

const UNIFIED_CHANNELS = new Set<string>([
  'app:version',
  'app:name',
  'app:platform',
  'settings:getAll',
  'settings:get',
  'settings:set',
  'settings:setMany',
  'settings:reset',
  'provider:list',
  'provider:get',
  'provider:getDefault',
  'provider:hasApiKey',
  'provider:getApiKey',
  'provider:validateKey',
  'provider:save',
  'provider:delete',
  'provider:setApiKey',
  'provider:updateWithKey',
  'provider:deleteApiKey',
  'provider:setDefault',
  'update:status',
  'update:version',
  'update:isSupported',
  'update:check',
  'update:download',
  'update:install',
  'update:setChannel',
  'update:setAutoDownload',
  'update:cancelAutoInstall',
  'cron:list',
  'cron:create',
  'cron:update',
  'cron:delete',
  'cron:toggle',
  'cron:trigger',
  'usage:recentTokenHistory',
]);

const SLOW_REQUEST_THRESHOLD_MS = 800;

function mapUnifiedErrorCode(code?: string): AppErrorCode {
  return mapBackendErrorCode(code);
}

function shouldLogApiRequests(): boolean {
  try {
    return import.meta.env.DEV || window.localStorage.getItem('clawclaw:api-log') === '1';
  } catch {
    return !!import.meta.env.DEV;
  }
}

function logApiAttempt(entry: {
  requestId: string;
  channel: string;
  durationMs: number;
  ok: boolean;
  error?: unknown;
}): void {
  if (!shouldLogApiRequests()) return;
  const base = `[api-client] id=${entry.requestId} channel=${entry.channel} transport=ipc durationMs=${entry.durationMs}`;
  if (entry.ok) {
    console.info(`${base} result=ok`);
  } else {
    console.warn(`${base} result=error`, entry.error);
  }
}

function toUnifiedRequest(channel: string, args: unknown[]): UnifiedRequest {
  const splitIndex = channel.indexOf(':');
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    module: channel.slice(0, splitIndex),
    action: channel.slice(splitIndex + 1),
    payload: args.length <= 1 ? args[0] : args,
  };
}

async function invokeViaIpc<T>(channel: string, args: unknown[]): Promise<T> {
  if (!window.desktop?.ipcRenderer?.invoke) {
    throw normalizeAppError(new Error('Desktop host bridge is unavailable'), {
      transport: 'ipc',
      channel,
      source: 'renderer',
    });
  }

  if (channel !== 'app:request' && UNIFIED_CHANNELS.has(channel)) {
    const request = toUnifiedRequest(channel, args);

    try {
      const response = (await window.desktop.ipcRenderer.invoke(
        'app:request',
        request
      )) as UnifiedResponse;
      if (!response?.ok) {
        const message = response?.error?.message || 'Unified IPC request failed';
        if (message.includes('APP_REQUEST_UNSUPPORTED:')) {
          throw new Error(message);
        }
        throw new AppError(mapUnifiedErrorCode(response?.error?.code), message, response?.error);
      }
      return response.data as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('APP_REQUEST_UNSUPPORTED:') ||
        message.includes('Invalid IPC channel: app:request')
      ) {
        // Fall through to legacy channel handlers for older main-process builds.
      } else {
        throw normalizeAppError(err, { transport: 'ipc', channel, source: 'app:request' });
      }
    }
  }

  try {
    return (await window.desktop.ipcRenderer.invoke(channel, ...args)) as T;
  } catch (err) {
    throw normalizeAppError(err, { transport: 'ipc', channel, source: 'legacy-ipc' });
  }
}

export function initializeDefaultTransports(): void {
  // Renderer transport is intentionally fixed to the desktop host IPC. Gateway protocol
  // selection and recovery belong to the main process.
}

export function applyGatewayTransportPreference(): void {
  // Compatibility shim for stale renderer modules during dev reloads.
  // Transport selection no longer lives in the renderer.
}

export function toUserMessage(error: unknown): string {
  const appError = error instanceof AppError ? error : normalizeAppError(error);

  switch (appError.code) {
    case 'AUTH_INVALID':
      return 'Authentication failed. Check API key or login session and retry.';
    case 'TIMEOUT':
      return 'Request timed out. Please retry.';
    case 'RATE_LIMIT':
      return 'Too many requests. Please wait and try again.';
    case 'PERMISSION':
      return 'Permission denied. Check your configuration and retry.';
    case 'CHANNEL_UNAVAILABLE':
      return 'Service channel unavailable. Retry after restarting the app or gateway.';
    case 'NETWORK':
      return 'Network error. Please verify connectivity and retry.';
    case 'CONFIG':
      return 'Configuration is invalid. Please review settings.';
    case 'GATEWAY':
      return 'Gateway is unavailable. Start or restart the gateway and retry.';
    default:
      return appError.message || 'Unexpected error occurred.';
  }
}

export async function invokeApi<T>(channel: string, ...args: unknown[]): Promise<T> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    const value = await invokeViaIpc<T>(channel, args);
    const durationMs = Date.now() - startedAt;
    logApiAttempt({ requestId, channel, durationMs, ok: true });
    if (durationMs >= SLOW_REQUEST_THRESHOLD_MS) {
      trackUiEvent('api.request', {
        requestId,
        channel,
        transport: 'ipc',
        durationMs,
      });
    }
    return value;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logApiAttempt({ requestId, channel, durationMs, ok: false, error: err });
    trackUiEvent('api.request_error', {
      requestId,
      channel,
      transport: 'ipc',
      durationMs,
      message: err instanceof Error ? err.message : String(err),
    });
    throw normalizeAppError(err, {
      requestId,
      channel,
      transport: 'ipc',
      durationMs,
    });
  }
}

export async function invokeIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  return invokeApi<T>(channel, ...args);
}

export async function invokeIpcWithRetry<T>(
  channel: string,
  args: unknown[] = [],
  retries = 1,
  retryable: AppErrorCode[] = ['TIMEOUT', 'NETWORK']
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i <= retries; i += 1) {
    try {
      return await invokeApi<T>(channel, ...args);
    } catch (err) {
      lastError = err;
      if (!(err instanceof AppError) || !retryable.includes(err.code) || i === retries) {
        throw err;
      }
    }
  }

  throw normalizeAppError(lastError);
}
