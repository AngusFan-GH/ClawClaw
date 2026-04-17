const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

const WECHAT_RUNTIME_CHANNEL_ID = 'openclaw-weixin';
const WECHAT_UI_CHANNEL_ID = 'wechat';

export type QrChannelEvent = 'qr' | 'success' | 'error';

export function toRuntimeChannelType(channelType: string): string {
  return channelType === WECHAT_UI_CHANNEL_ID ? WECHAT_RUNTIME_CHANNEL_ID : channelType;
}

// Backward-compatible alias used by older route helpers.
export function toOpenClawChannelType(channelType: string): string {
  return toRuntimeChannelType(channelType);
}

export function toUiChannelType(channelType: string): string {
  return channelType === WECHAT_RUNTIME_CHANNEL_ID ? WECHAT_UI_CHANNEL_ID : channelType;
}

export function isWeChatRuntimeChannel(channelType: string): boolean {
  return channelType === WECHAT_RUNTIME_CHANNEL_ID;
}

export function isWeChatChannelType(channelType: string | null | undefined): boolean {
  return channelType === WECHAT_UI_CHANNEL_ID || channelType === WECHAT_RUNTIME_CHANNEL_ID;
}

export function usesPluginManagedQrAccounts(channelType: string | null | undefined): boolean {
  return isWeChatChannelType(channelType);
}

export function buildQrChannelEventName(channelType: string, event: QrChannelEvent): string {
  return `channel:${toUiChannelType(channelType)}-${event}`;
}

function canonicalizeAccountId(value: string): string {
  if (VALID_ID_RE.test(value)) return value.toLowerCase();
  return value
    .toLowerCase()
    .replace(INVALID_CHARS_RE, '-')
    .replace(LEADING_DASH_RE, '')
    .replace(TRAILING_DASH_RE, '')
    .slice(0, 64);
}

export function normalizeOpenClawAccountId(value: string | null | undefined, fallback = 'default'): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return fallback;
  const normalized = canonicalizeAccountId(trimmed);
  if (!normalized || BLOCKED_OBJECT_KEYS.has(normalized)) {
    return fallback;
  }
  return normalized;
}

export { WECHAT_RUNTIME_CHANNEL_ID, WECHAT_UI_CHANNEL_ID };
