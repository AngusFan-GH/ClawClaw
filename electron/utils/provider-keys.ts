const MULTI_INSTANCE_PROVIDER_TYPES = new Set(['custom', 'ollama', 'local-model']);

export const OPENCLAW_PROVIDER_KEY_MINIMAX = 'minimax-portal';
export const OPENCLAW_PROVIDER_KEY_QWEN = 'qwen-portal';
export const OPENCLAW_PROVIDER_KEY_MOONSHOT = 'moonshot';
export const OAUTH_PROVIDER_TYPES = ['qwen-portal', 'minimax-portal', 'minimax-portal-cn'] as const;
export const OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEYS = [
  OPENCLAW_PROVIDER_KEY_MINIMAX,
  OPENCLAW_PROVIDER_KEY_QWEN,
] as const;

const OAUTH_PROVIDER_TYPE_SET = new Set<string>(OAUTH_PROVIDER_TYPES);
const OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEY_SET = new Set<string>(OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEYS);

const PROVIDER_KEY_ALIASES: Record<string, string> = {
  'minimax-portal-cn': OPENCLAW_PROVIDER_KEY_MINIMAX,
};

export function getOpenClawProviderInstanceSuffix(providerId: string): string {
  const normalized = providerId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return normalized || 'default';
}

export function getOpenClawProviderKeyForType(type: string, providerId: string): string {
  if (MULTI_INSTANCE_PROVIDER_TYPES.has(type)) {
    const suffix = getOpenClawProviderInstanceSuffix(providerId);
    return `${type}-${suffix}`;
  }

  return PROVIDER_KEY_ALIASES[type] ?? type;
}

export function isOAuthProviderType(type: string): boolean {
  return OAUTH_PROVIDER_TYPE_SET.has(type);
}

export function isMiniMaxProviderType(type: string): boolean {
  return type === OPENCLAW_PROVIDER_KEY_MINIMAX || type === 'minimax-portal-cn';
}

export function getOAuthProviderTargetKey(type: string): string | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  return isMiniMaxProviderType(type) ? OPENCLAW_PROVIDER_KEY_MINIMAX : OPENCLAW_PROVIDER_KEY_QWEN;
}

export function getOAuthProviderApi(type: string): 'anthropic-messages' | 'openai-completions' | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  return isMiniMaxProviderType(type) ? 'anthropic-messages' : 'openai-completions';
}

export function getOAuthProviderDefaultBaseUrl(type: string): string | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  if (type === OPENCLAW_PROVIDER_KEY_MINIMAX) return 'https://api.minimax.io/anthropic';
  if (type === 'minimax-portal-cn') return 'https://api.minimaxi.com/anthropic';
  return 'https://portal.qwen.ai/v1';
}

export function normalizeOAuthBaseUrl(type: string, baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  if (isMiniMaxProviderType(type)) {
    return baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
  }
  return baseUrl;
}

export function usesOAuthAuthHeader(providerKey: string): boolean {
  return providerKey === OPENCLAW_PROVIDER_KEY_MINIMAX;
}

export function getOAuthApiKeyEnv(providerKey: string): string | undefined {
  if (providerKey === OPENCLAW_PROVIDER_KEY_MINIMAX) return 'minimax-oauth';
  if (providerKey === OPENCLAW_PROVIDER_KEY_QWEN) return 'qwen-oauth';
  return undefined;
}

export function isOpenClawOAuthPluginProviderKey(provider: string): boolean {
  return OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEY_SET.has(provider);
}
