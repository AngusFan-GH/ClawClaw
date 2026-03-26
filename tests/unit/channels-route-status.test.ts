import { describe, expect, it } from 'vitest';
import { mapAccountStatus, resolveGroupStatus } from '@electron/api/routes/channels';

describe('channel route runtime status helpers', () => {
  it('treats connected accounts as connected even if a stale lastError is present', () => {
    expect(
      mapAccountStatus({
        connected: true,
        lastError: 'Client network socket disconnected before secure TLS connection was established',
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
});
