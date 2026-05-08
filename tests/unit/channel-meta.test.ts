import { describe, expect, it } from 'vitest';
import { CHANNEL_META, channelSupportsMultipleAccounts } from '@/types/channel';

describe('channel metadata', () => {
  it('treats WeChat as a single-account connection in ClawClaw', () => {
    expect(CHANNEL_META.wechat.supportsMultipleAccounts).toBe(false);
    expect(channelSupportsMultipleAccounts('wechat')).toBe(false);
  });

  it('marks feishu as a multi-account channel to match OpenClaw upstream', () => {
    expect(CHANNEL_META.feishu.supportsMultipleAccounts).toBe(true);
    expect(channelSupportsMultipleAccounts('feishu')).toBe(true);
  });

  it('exposes the Feishu/Lark domain selector required by upstream config', () => {
    const domainField = CHANNEL_META.feishu.configFields.find((field) => field.key === 'domain');
    expect(domainField?.type).toBe('select');
    expect(domainField?.options?.map((option) => option.value)).toEqual(['feishu', 'lark']);
  });
});
