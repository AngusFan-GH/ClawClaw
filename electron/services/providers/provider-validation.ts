import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getProviderConfig } from '../../utils/provider-registry';
import { logger } from '../../utils/logger';

type ValidationProfile =
  | 'openai-compatible'
  | 'google-query-key'
  | 'anthropic-header'
  | 'openrouter'
  | 'none';

type ProviderModelOption = {
  id: string;
  name: string;
  category?: string;
  typeLabel?: string;
  input?: string;
  contextWindow?: number | null;
  tags?: string[];
};

function logValidationStatus(provider: string, status: number): void {
  console.log(`[clawclaw-validate] ${provider} HTTP ${status}`);
}

function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return `${secret.slice(0, 2)}***`;
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function sanitizeValidationUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const key = url.searchParams.get('key');
    if (key) url.searchParams.set('key', maskSecret(key));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const next = { ...headers };
  if (next.Authorization?.startsWith('Bearer ')) {
    const token = next.Authorization.slice('Bearer '.length);
    next.Authorization = `Bearer ${maskSecret(token)}`;
  }
  if (next['x-api-key']) {
    next['x-api-key'] = maskSecret(next['x-api-key']);
  }
  return next;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildOpenAiModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models?limit=1`;
}

function logValidationRequest(
  provider: string,
  method: string,
  url: string,
  headers: Record<string, string>,
): void {
  console.log(
    `[clawclaw-validate] ${provider} request ${method} ${sanitizeValidationUrl(url)} headers=${JSON.stringify(sanitizeHeaders(headers))}`,
  );
}

function logModelDiscoveryStart(
  providerType: string,
  profile: ValidationProfile,
  options?: { baseUrl?: string; apiProtocol?: string },
): void {
  logger.info(
    `[provider-model-discovery] start provider=${providerType} profile=${profile} baseUrl=${options?.baseUrl?.trim() || 'default'} apiProtocol=${options?.apiProtocol || 'default'}`,
  );
}

function logModelDiscoveryResult(
  providerType: string,
  profile: ValidationProfile,
  result: { models: ProviderModelOption[]; error?: string },
): void {
  if (result.error) {
    logger.warn(
      `[provider-model-discovery] failed provider=${providerType} profile=${profile} error=${result.error}`,
    );
    return;
  }

  logger.info(
    `[provider-model-discovery] success provider=${providerType} profile=${profile} count=${result.models.length}`,
  );
}

function getValidationProfile(
  providerType: string,
  options?: { apiProtocol?: string },
): ValidationProfile {
  const providerApi = options?.apiProtocol || getProviderConfig(providerType)?.api;
  if (providerApi === 'anthropic-messages') {
    return 'anthropic-header';
  }
  if (providerApi === 'openai-completions' || providerApi === 'openai-responses') {
    return 'openai-compatible';
  }

  switch (providerType) {
    case 'anthropic':
      return 'anthropic-header';
    case 'google':
      return 'google-query-key';
    case 'openrouter':
      return 'openrouter';
    case 'ollama':
      return 'none';
    default:
      return 'openai-compatible';
  }
}

async function performProviderValidationRequest(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<{ valid: boolean; error?: string }> {
  try {
    logValidationRequest(providerLabel, 'GET', url, headers);
    const response = await proxyAwareFetch(url, { headers });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function classifyAuthResponse(status: number, data: unknown): { valid: boolean; error?: string } {
  if (status >= 200 && status < 300) return { valid: true };
  if (status === 429) return { valid: true };
  if (status === 401 || status === 403) return { valid: false, error: 'Invalid API key' };

  const obj = data as { error?: { message?: string }; message?: string } | null;
  const msg = obj?.error?.message || obj?.message || `API error: ${status}`;
  return { valid: false, error: msg };
}

function extractErrorMessage(status: number, data: unknown): string {
  const obj = data as { error?: { message?: string }; message?: string; code?: string } | null;
  return obj?.error?.message || obj?.message || obj?.code || `API error: ${status}`;
}

async function validateOpenAiCompatibleKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ valid: boolean; error?: string }> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return {
      valid: false,
      error: `Base URL is required for provider "${providerType}" validation`,
    };
  }

  const headers = { Authorization: `Bearer ${apiKey}` };
  const modelsUrl = buildOpenAiModelsUrl(trimmedBaseUrl);
  const modelsResult = await performProviderValidationRequest(providerType, modelsUrl, headers);

  if (modelsResult.error?.includes('API error: 404')) {
    console.log(
      `[clawclaw-validate] ${providerType} /models returned 404, falling back to /chat/completions probe`,
    );
    const base = normalizeBaseUrl(trimmedBaseUrl);
    const chatUrl = `${base}/chat/completions`;
    return await performChatCompletionsProbe(providerType, chatUrl, headers);
  }

  return modelsResult;
}

function normalizeModelCategory(raw: unknown): string | undefined {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return undefined;
  if (value.includes('embed')) return 'embedding';
  if (
    value.includes('vision')
    || value.includes('image')
    || value.includes('multimodal')
    || value.includes('multi-modal')
    || value.includes('vl')
  ) return 'vision';
  if (value.includes('audio') || value.includes('speech') || value.includes('tts') || value.includes('asr')) return 'audio';
  if (value.includes('reason')) return 'reasoning';
  if (value.includes('code')) return 'code';
  if (value.includes('chat') || value.includes('instruct') || value.includes('text') || value.includes('llm')) return 'chat';
  return 'other';
}

function extractStringArray(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const items = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function mapOpenAiModelList(data: unknown): ProviderModelOption[] {
  const payload = data as {
    data?: Array<{
      id?: string;
      name?: string;
      type_code?: string;
      typeCode?: string;
      contextWindow?: number;
      max_model_len?: number;
      maxModelLen?: number;
      gpu_models?: string[];
      gpuModels?: string[];
      owned_by?: string;
      ownedBy?: string;
    }>;
  } | null;
  const raw = Array.isArray(payload?.data) ? payload.data : [];
  return raw
    .map((item) => ({
      id: typeof item?.id === 'string' ? item.id.trim() : '',
      name: typeof item?.name === 'string' && item.name.trim()
        ? item.name.trim()
        : (typeof item?.id === 'string' ? item.id.trim() : ''),
      category: normalizeModelCategory(item?.typeCode ?? item?.type_code),
      typeLabel:
        typeof item?.typeCode === 'string' && item.typeCode.trim()
          ? item.typeCode.trim()
          : (typeof item?.type_code === 'string' && item.type_code.trim() ? item.type_code.trim() : undefined),
      contextWindow:
        typeof item?.contextWindow === 'number'
          ? item.contextWindow
          : (typeof item?.max_model_len === 'number'
            ? item.max_model_len
            : (typeof item?.maxModelLen === 'number' ? item.maxModelLen : undefined)),
      tags: Array.from(new Set([
        ...(extractStringArray(item?.gpuModels) ?? extractStringArray(item?.gpu_models) ?? []),
        ...(typeof item?.owned_by === 'string' && item.owned_by.trim() ? [item.owned_by.trim()] : []),
        ...(typeof item?.ownedBy === 'string' && item.ownedBy.trim() ? [item.ownedBy.trim()] : []),
      ])),
    }))
    .filter((item) => Boolean(item.id));
}

function mapGoogleModelList(data: unknown): ProviderModelOption[] {
  const payload = data as { models?: Array<{ name?: string; displayName?: string }> } | null;
  const raw = Array.isArray(payload?.models) ? payload.models : [];
  return raw
    .map((item) => {
      const rawName = typeof item?.name === 'string' ? item.name.trim() : '';
      const id = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
      return {
        id,
        name: typeof item?.displayName === 'string' && item.displayName.trim()
          ? item.displayName.trim()
          : id,
      };
    })
    .filter((item) => Boolean(item.id));
}

async function fetchModelListRequest(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
  mapper: (data: unknown) => ProviderModelOption[] = mapOpenAiModelList,
): Promise<{ models: ProviderModelOption[]; error?: string }> {
  try {
    logValidationRequest(providerLabel, 'GET', url, headers);
    const response = await proxyAwareFetch(url, { headers });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    if (response.status < 200 || response.status >= 300) {
      return { models: [], error: extractErrorMessage(response.status, data) };
    }
    return { models: mapper(data) };
  } catch (error) {
    return {
      models: [],
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function listOpenAiCompatibleModels(
  providerType: string,
  apiKey: string | undefined,
  baseUrl?: string,
): Promise<{ models: ProviderModelOption[]; error?: string }> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return { models: [], error: `Base URL is required for provider "${providerType}"` };
  }
  const headers = apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {};
  const modelsUrl = buildOpenAiModelsUrl(trimmedBaseUrl);
  return await fetchModelListRequest(providerType, modelsUrl, headers, mapOpenAiModelList);
}

async function listAnthropicCompatibleModels(
  providerType: string,
  apiKey: string | undefined,
  baseUrl?: string,
): Promise<{ models: ProviderModelOption[]; error?: string }> {
  const trimmedKey = apiKey?.trim();
  if (!trimmedKey) {
    return { models: [], error: 'API key is required' };
  }
  const rawBase = normalizeBaseUrl(baseUrl || 'https://api.anthropic.com/v1');
  const base = rawBase.endsWith('/v1') ? rawBase : `${rawBase}/v1`;
  const url = `${base}/models?limit=200`;
  const headers = {
    'x-api-key': trimmedKey,
    'anthropic-version': '2023-06-01',
  };
  return await fetchModelListRequest(providerType, url, headers, mapOpenAiModelList);
}

async function listGoogleModels(
  providerType: string,
  apiKey: string | undefined,
  baseUrl?: string,
): Promise<{ models: ProviderModelOption[]; error?: string }> {
  const trimmedKey = apiKey?.trim();
  if (!trimmedKey) {
    return { models: [], error: 'API key is required' };
  }
  const base = normalizeBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  const url = `${base}/models?pageSize=200&key=${encodeURIComponent(trimmedKey)}`;
  return await fetchModelListRequest(providerType, url, {}, mapGoogleModelList);
}

async function performChatCompletionsProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<{ valid: boolean; error?: string }> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await proxyAwareFetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key' };
    }
    if (
      (response.status >= 200 && response.status < 300)
      || response.status === 400
      || response.status === 429
    ) {
      return { valid: true };
    }
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function performAnthropicMessagesProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
): Promise<{ valid: boolean; error?: string }> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await proxyAwareFetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key' };
    }
    if (
      (response.status >= 200 && response.status < 300)
      || response.status === 400
      || response.status === 429
    ) {
      return { valid: true };
    }
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function validateGoogleQueryKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ valid: boolean; error?: string }> {
  const base = normalizeBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  const url = `${base}/models?pageSize=1&key=${encodeURIComponent(apiKey)}`;
  return await performProviderValidationRequest(providerType, url, {});
}

async function validateAnthropicHeaderKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ valid: boolean; error?: string }> {
  const rawBase = normalizeBaseUrl(baseUrl || 'https://api.anthropic.com/v1');
  const base = rawBase.endsWith('/v1') ? rawBase : `${rawBase}/v1`;
  const url = `${base}/models?limit=1`;
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  const modelsResult = await performProviderValidationRequest(providerType, url, headers);

  if (
    modelsResult.error?.includes('API error: 404')
    || modelsResult.error?.includes('API error: 400')
  ) {
    console.log(
      `[clawclaw-validate] ${providerType} /models returned error, falling back to /messages probe`,
    );
    const messagesUrl = `${base}/messages`;
    return await performAnthropicMessagesProbe(providerType, messagesUrl, headers);
  }

  return modelsResult;
}

async function validateOpenRouterKey(
  providerType: string,
  apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  const url = 'https://openrouter.ai/api/v1/auth/key';
  const headers = { Authorization: `Bearer ${apiKey}` };
  return await performProviderValidationRequest(providerType, url, headers);
}

export async function validateApiKeyWithProvider(
  providerType: string,
  apiKey: string,
  options?: { baseUrl?: string; apiProtocol?: string },
): Promise<{ valid: boolean; error?: string }> {
  const profile = getValidationProfile(providerType, options);
  const resolvedBaseUrl = options?.baseUrl || getProviderConfig(providerType)?.baseUrl;

  if (profile === 'none') {
    return { valid: true };
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { valid: false, error: 'API key is required' };
  }

  try {
    switch (profile) {
      case 'openai-compatible':
        return await validateOpenAiCompatibleKey(providerType, trimmedKey, resolvedBaseUrl);
      case 'google-query-key':
        return await validateGoogleQueryKey(providerType, trimmedKey, resolvedBaseUrl);
      case 'anthropic-header':
        return await validateAnthropicHeaderKey(providerType, trimmedKey, resolvedBaseUrl);
      case 'openrouter':
        return await validateOpenRouterKey(providerType, trimmedKey);
      default:
        return {
          valid: false,
          error: `Unsupported validation profile for provider: ${providerType}`,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  }
}

export async function listModelsWithProvider(
  providerType: string,
  apiKey?: string,
  options?: { baseUrl?: string; apiProtocol?: string },
): Promise<{ models: ProviderModelOption[]; error?: string }> {
  const profile = getValidationProfile(providerType, options);
  const resolvedBaseUrl = options?.baseUrl || getProviderConfig(providerType)?.baseUrl;
  logModelDiscoveryStart(providerType, profile, {
    baseUrl: resolvedBaseUrl,
    apiProtocol: options?.apiProtocol,
  });

  let result: { models: ProviderModelOption[]; error?: string };
  switch (profile) {
    case 'openai-compatible':
      result = await listOpenAiCompatibleModels(providerType, apiKey, resolvedBaseUrl);
      break;
    case 'google-query-key':
      result = await listGoogleModels(providerType, apiKey, resolvedBaseUrl);
      break;
    case 'anthropic-header':
      result = await listAnthropicCompatibleModels(providerType, apiKey, resolvedBaseUrl);
      break;
    case 'openrouter':
      result = await listOpenAiCompatibleModels(providerType, apiKey, 'https://openrouter.ai/api/v1');
      break;
    case 'none':
      if (providerType === 'ollama') {
        result = await listOpenAiCompatibleModels(providerType, undefined, resolvedBaseUrl);
        break;
      }
      result = { models: [] };
      break;
    default:
      result = { models: [] };
      break;
  }

  logModelDiscoveryResult(providerType, profile, result);
  return result;
}
