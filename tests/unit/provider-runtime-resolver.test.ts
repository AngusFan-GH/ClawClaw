import { describe, expect, it, vi } from 'vitest';
import { resolveProviderRuntime } from '@backend/services/providers/provider-runtime-resolver';

vi.mock('../../backend/host/desktop', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/clawclaw-test',
    getVersion: () => '0.0.0-test',
    getAppPath: () => process.cwd(),
  },
}));

describe('provider runtime resolver', () => {
  it('maps oauth-backed providers to runtime-only catalogs', async () => {
    const providerService = {
      getAccount: vi.fn(async (accountId: string) => {
        if (accountId === 'openai-oauth') {
          return {
            id: accountId,
            vendorId: 'openai',
            authMode: 'oauth_browser',
          };
        }
        return null;
      }),
    } as const;

    await expect(
      resolveProviderRuntime(providerService as never, 'openai', 'oauth_browser', 'openai-oauth'),
    ).resolves.toEqual({
      runtimeProviderId: 'openai-codex',
      runtimeOnlyCatalog: true,
    });
  });

  it('resolves stored self-hosted accounts to their runtime provider keys', async () => {
    const providerService = {
      getAccount: vi.fn(async () => ({
        id: 'custom-6012f49b-71fa-4dd6-8f5e-f82364876d38',
        vendorId: 'custom',
        authMode: 'api_key',
      })),
    } as const;

    await expect(
      resolveProviderRuntime(providerService as never, 'custom', 'api_key', 'custom-6012f49b-71fa-4dd6-8f5e-f82364876d38'),
    ).resolves.toEqual({
      runtimeProviderId: 'custom-custom6012f49b71fa4dd68f5ef82364876d38',
      runtimeOnlyCatalog: false,
    });
  });
});
