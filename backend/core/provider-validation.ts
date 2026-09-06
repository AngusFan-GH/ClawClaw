/**
 * Live provider validation.
 *
 * The ONLY outbound network call for a provider is a minimal probe to the
 * endpoint the user configured. Headers, keys and URLs are never logged.
 * Errors are mapped to stable codes the renderer can localize.
 */
import type { CoreErrorCode } from './errors';
import { isLocalVendor } from './provider-catalog';
import type { ProviderRow } from './provider-store';
import type { ApiProtocol } from './provider-catalog';

export interface ValidationResult {
  ok: boolean;
  code?: CoreErrorCode;
  message?: string;
  model?: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 12_000;

export class ProviderValidator {
  constructor(private readonly fetchImpl: FetchLike = globalThis.fetch) {}

  async validate(row: ProviderRow, apiKey: string | null): Promise<ValidationResult> {
    const baseUrl = row.base_url;
    if (!baseUrl) return { ok: false, code: 'PROVIDER_VALIDATION_FAILED', message: 'No endpoint configured' };
    if (row.auth_mode === 'api_key' && !apiKey) {
      return { ok: false, code: 'PROVIDER_SECRET_MISSING', message: 'API key is missing' };
    }
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, code: 'INVALID_ARGUMENT', message: 'Endpoint must be http(s)' };
      }
    } catch {
      return { ok: false, code: 'INVALID_ARGUMENT', message: 'Endpoint URL is invalid' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const protocol = (row.api_protocol ?? 'openai-completions') as unknown as ApiProtocol;
      if (protocol === 'anthropic-messages') return await this.probeAnthropic(baseUrl, row.model, apiKey, controller.signal);
      return await this.probeOpenAiModels(baseUrl, apiKey, controller.signal);
    } catch (error) {
      return mapNetworkError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  private async probeOpenAiModels(baseUrl: string, apiKey: string | null, signal: AbortSignal): Promise<ValidationResult> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const response = await this.fetchImpl(joinUrl(baseUrl, 'models'), { method: 'GET', headers, signal });
    if (response.ok) return { ok: true };
    return failureForStatus(response.status);
  }

  private async probeAnthropic(baseUrl: string, model: string | null, apiKey: string | null, signal: AbortSignal): Promise<ValidationResult> {
    if (!apiKey) return { ok: false, code: 'PROVIDER_SECRET_MISSING', message: 'API key is missing' };
    const response = await this.fetchImpl(joinUrl(baseUrl, 'messages'), {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: model || 'claude-3-5-haiku-latest',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (response.ok) return { ok: true, model: model ?? undefined };
    // 400 with a model-related body still proves the key authenticated on some gateways.
    if (response.status === 400) {
      const text = await safeText(response);
      if (/model|not found|deployment/i.test(text)) return { ok: true, model: model ?? undefined };
    }
    return failureForStatus(response.status);
  }
}

function failureForStatus(status: number): ValidationResult {
  if (status === 401 || status === 403) {
    return { ok: false, code: 'PROVIDER_AUTH_FAILED', message: 'Authentication failed (check the API key)' };
  }
  if (status === 429) return { ok: false, code: 'PROVIDER_RATE_LIMITED', message: 'Rate limited by the provider' };
  if (status >= 500) return { ok: false, code: 'PROVIDER_NETWORK_ERROR', message: `Provider returned ${status}` };
  return { ok: false, code: 'PROVIDER_VALIDATION_FAILED', message: `Provider returned ${status}` };
}

function mapNetworkError(error: unknown): ValidationResult {
  const message = error instanceof Error ? error.message : String(error);
  if (/aborted|timed out|timeout/i.test(message)) {
    return { ok: false, code: 'PROVIDER_TIMEOUT', message: 'The request timed out' };
  }
  if (/certificate|tls|ssl|self.signed|authority/i.test(message)) {
    return { ok: false, code: 'PROVIDER_TLS_ERROR', message: 'TLS/certificate verification failed' };
  }
  if (/fetch failed|enotfound|econnrefused|econnreset|network|unreachable|getaddrinfo/i.test(message)) {
    return { ok: false, code: 'PROVIDER_NETWORK_ERROR', message: 'Cannot reach the endpoint' };
  }
  return { ok: false, code: 'PROVIDER_NETWORK_ERROR', message: 'Network request failed' };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path}`;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return '';
  }
}

export { isLocalVendor };
