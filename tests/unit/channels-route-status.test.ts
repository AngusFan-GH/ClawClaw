import { describe, expect, it } from 'vitest';
import {
  mapAccountStatus,
  normalizeAccountStatusForUi,
  resolveGroupStatus,
} from '@electron/api/routes/channels';

describe('channel route runtime status helpers', () => {
  it('treats connected accounts as connected even if a stale lastError is present', () => {
    expect(
      mapAccountStatus({
        connected: true,
        lastError: 'Client network socket disconnected before secure TLS connection was established',
      }),
    ).toBe('connected');
  });

  it('treats recent heartbeat events as connected for channels that only report lastEventAt', () => {
    expect(
      mapAccountStatus({
        configured: true,
        lastEventAt: Date.now(),
      }),
    ).toBe('connected');
  });

  it('treats running accounts as connected (OpenClaw parity)', () => {
    expect(
      mapAccountStatus({
        configured: true,
        running: true,
      }),
    ).toBe('connected');
  });

  it('does not keep a group in error when an account is currently connected', () => {
    expect(
      resolveGroupStatus({
        type: 'wecom',
        name: 'wecom',
        status: 'unknown',
        configured: true,
        runtimeLoaded: true,
        runtimeStatus: 'unknown',
        pluginLoaded: true,
        configuredAccounts: ['default'],
        accounts: [
          {
            id: 'wecom:default',
            type: 'wecom',
            name: 'wecom',
            status: 'connected',
            configured: true,
            runtimeLoaded: true,
            runtimeStatus: 'connected',
            accountId: 'default',
            isDefaultAccount: true,
          },
        ],
        error: undefined,
      }),
    ).toBe('connected');
  });

  it('keeps UI status pass-through without channel-specific overrides', () => {
    expect(
      normalizeAccountStatusForUi({
        channelType: 'feishu',
        mappedStatus: 'connecting',
      }),
    ).toBe('connecting');
  });

  it('keeps disconnected pass-through without channel-specific overrides', () => {
    expect(
      normalizeAccountStatusForUi({
        channelType: 'qqbot',
        mappedStatus: 'disconnected',
      }),
    ).toBe('disconnected');
  });

});
