import { describe, expect, it } from 'vitest';
import { CHANNEL_META, channelSupportsMultipleAccounts } from '@/types/channel';

describe('channel metadata', () => {
  it('marks feishu as a multi-account channel to match OpenClaw upstream', () => {
    expect(CHANNEL_META.feishu.supportsMultipleAccounts).toBe(true);
    expect(channelSupportsMultipleAccounts('feishu')).toBe(true);
  });
});
