import { describe, expect, it } from 'vitest';

import { resolveRuntimeAccountIdForUi } from '@electron/api/routes/channels';

describe('resolveRuntimeAccountIdForUi', () => {
  it('maps a runtime default account to the sole configured named account', () => {
    expect(
      resolveRuntimeAccountIdForUi({
        reportedAccountId: 'default',
        configuredAccounts: ['feishu3'],
        explicitDefaultAccountId: 'feishu3',
        runtimeConfigured: false,
      }),
    ).toBe('feishu3');
  });

  it('maps a runtime named account back onto the configured default account when config is top-level only', () => {
    expect(
      resolveRuntimeAccountIdForUi({
        reportedAccountId: 'feishu3',
        configuredAccounts: ['default'],
        explicitDefaultAccountId: 'default',
        runtimeConfigured: false,
      }),
    ).toBe('default');
  });

  it('still maps a runtime configured named account back onto the configured default account when config is top-level only', () => {
    expect(
      resolveRuntimeAccountIdForUi({
        reportedAccountId: 'feishu3',
        configuredAccounts: ['default'],
        explicitDefaultAccountId: 'default',
        runtimeConfigured: true,
      }),
    ).toBe('default');
  });

  it('skips ambiguous runtime default accounts when multiple named accounts exist', () => {
    expect(
      resolveRuntimeAccountIdForUi({
        reportedAccountId: 'default',
        configuredAccounts: ['default', 'feishu3', 'feishu4'].filter((accountId) => accountId !== 'default'),
        explicitDefaultAccountId: undefined,
        runtimeConfigured: false,
      }),
    ).toBeNull();
  });

  it('keeps an explicitly configured runtime default account as default', () => {
    expect(
      resolveRuntimeAccountIdForUi({
        reportedAccountId: 'default',
        configuredAccounts: ['default', 'feishu3'],
        explicitDefaultAccountId: 'default',
        runtimeConfigured: true,
      }),
    ).toBe('default');
  });
});
