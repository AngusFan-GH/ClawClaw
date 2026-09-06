import { invokeIpc } from '@/lib/api-client';
import { trackUiEvent } from './telemetry';
import { normalizeAppError } from './error-model';

type HostApiProxyResponse = {
  ok?: boolean;
  data?: {
    status?: number;
    ok?: boolean;
    json?: unknown;
    text?: string;
  };
  error?: { message?: string } | string;
  // backward compatibility fields
  success: boolean;
  status?: number;
  json?: unknown;
  text?: string;
};

type HostApiFetchInit = RequestInit & {
  timeoutMs?: number;
};

type HostApiProxyData = {
  status?: number;
  ok?: boolean;
  json?: unknown;
  text?: string;
};

let hostApiBase = 'http://127.0.0.1:3210';

export async function refreshHostApiBase(): Promise<void> {
  const baseUrl = await invokeIpc<string>('hostapi:getBaseUrl');
  if (typeof baseUrl === 'string' && baseUrl.startsWith('http://127.0.0.1:')) {
    hostApiBase = baseUrl;
  }
}

export function getHostApiBase(): string {
  return hostApiBase;
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function resolveProxyErrorMessage(error: HostApiProxyResponse['error']): string {
  return typeof error === 'string'
    ? error
    : (error?.message || 'Host API proxy request failed');
}

function parseUnifiedProxyResponse<T>(
  response: HostApiProxyResponse,
  path: string,
  method: string,
  startedAt: number,
): T {
  if (!response.ok) {
    throw new Error(resolveProxyErrorMessage(response.error));
  }

  const data: HostApiProxyData = response.data ?? {};
  trackUiEvent('hostapi.fetch', {
    path,
    method,
    source: 'ipc-proxy',
    durationMs: Date.now() - startedAt,
    status: data.status ?? 200,
  });

  if (data.ok === false || (typeof data.status === 'number' && data.status >= 400)) {
    const jsonError =
      data.json && typeof data.json === 'object' && 'error' in (data.json as Record<string, unknown>)
        ? String((data.json as Record<string, unknown>).error)
        : undefined;
    const textError = typeof data.text === 'string' && data.text.trim() ? data.text.trim() : undefined;
    const message = jsonError || textError || `HTTP ${data.status ?? 'unknown'}`;
    throw normalizeAppError(new Error(message), {
      source: 'ipc-proxy',
      status: data.status,
      path,
      method,
    });
  }

  if (data.status === 204) return undefined as T;
  if (data.json !== undefined) return data.json as T;
  return data.text as T;
}

function parseLegacyProxyResponse<T>(
  response: HostApiProxyResponse,
  path: string,
  method: string,
  startedAt: number,
): T {
  if (!response.success) {
    throw new Error(resolveProxyErrorMessage(response.error));
  }

  if (!response.ok) {
    const message = response.text
      || (typeof response.json === 'object' && response.json != null && 'error' in (response.json as Record<string, unknown>)
        ? String((response.json as Record<string, unknown>).error)
        : `HTTP ${response.status ?? 'unknown'}`);
    throw new Error(message);
  }

  trackUiEvent('hostapi.fetch', {
    path,
    method,
    source: 'ipc-proxy-legacy',
    durationMs: Date.now() - startedAt,
    status: response.status ?? 200,
  });

  if (response.status === 204) return undefined as T;
  if (response.json !== undefined) return response.json as T;
  return response.text as T;
}

export async function hostApiFetch<T>(path: string, init?: HostApiFetchInit): Promise<T> {
  const startedAt = Date.now();
  const method = init?.method || 'GET';
  // Always proxy through the backend process to avoid CORS.
  try {
    const response = await invokeIpc<HostApiProxyResponse>('hostapi:fetch', {
      path,
      method,
      headers: headersToRecord(init?.headers),
      body: init?.body ?? null,
      timeoutMs: init?.timeoutMs,
    });

    if (typeof response?.ok === 'boolean' && 'data' in response) {
      return parseUnifiedProxyResponse<T>(response, path, method, startedAt);
    }

    return parseLegacyProxyResponse<T>(response, path, method, startedAt);
  } catch (error) {
    const normalized = normalizeAppError(error, { source: 'ipc-proxy', path, method });
    const message = normalized.message;
    trackUiEvent('hostapi.fetch_error', {
      path,
      method,
      source: 'ipc-proxy',
      durationMs: Date.now() - startedAt,
      message,
      code: normalized.code,
    });
    throw normalized;
  }
}
