const WECHAT_RUNTIME_CHANNEL_ID = 'openclaw-weixin';
const WECHAT_UI_CHANNEL_ID = 'wechat';

export type QrChannelEvent = 'qr' | 'success' | 'error';

export function toUiChannelType(channelType: string): string {
  return channelType === WECHAT_RUNTIME_CHANNEL_ID ? WECHAT_UI_CHANNEL_ID : channelType;
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
