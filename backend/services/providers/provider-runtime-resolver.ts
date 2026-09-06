import type { HostApiContext } from '../../api/context';
import { readLocalModelPresets } from './local-model-presets';
import type { ProviderService } from './provider-service';
import { getOpenClawProviderKeyForType } from '../../utils/provider-keys';

const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';
const GOOGLE_OAUTH_RUNTIME_PROVIDER = 'google-gemini-cli';

export type ProviderRuntimeResolution = {
  runtimeProviderId: string;
  runtimeOnlyCatalog: boolean;
};

function getRuntimeProviderId(vendorId: string, authMode?: string | null): string {
  if (vendorId === 'openai' && (authMode === 'oauth_browser' || authMode === 'oauth_device')) {
    return OPENAI_OAUTH_RUNTIME_PROVIDER;
  }
  if (vendorId === 'google' && authMode === 'oauth_browser') {
    return GOOGLE_OAUTH_RUNTIME_PROVIDER;
  }
  return vendorId;
}

function isRuntimeOnlyModelCatalog(vendorId: string, authMode?: string | null): boolean {
  return (
    (vendorId === 'openai' && (authMode === 'oauth_browser' || authMode === 'oauth_device'))
    || (vendorId === 'google' && authMode === 'oauth_browser')
  );
}

export async function resolveProviderRuntime(
  providerService: ProviderService,
  vendorId: string,
  authMode?: string | null,
  accountId?: string | null,
): Promise<ProviderRuntimeResolution> {
  if (!accountId) {
    return {
      runtimeProviderId: getRuntimeProviderId(vendorId, authMode),
      runtimeOnlyCatalog: isRuntimeOnlyModelCatalog(vendorId, authMode),
    };
  }

  const account = await providerService.getAccount(accountId);
  if (!account) {
    return {
      runtimeProviderId: getRuntimeProviderId(vendorId, authMode),
      runtimeOnlyCatalog: isRuntimeOnlyModelCatalog(vendorId, authMode),
    };
  }

  if (
    account.vendorId === 'openai'
    && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device')
  ) {
    return {
      runtimeProviderId: OPENAI_OAUTH_RUNTIME_PROVIDER,
      runtimeOnlyCatalog: true,
    };
  }

  if (account.vendorId === 'google' && account.authMode === 'oauth_browser') {
    return {
      runtimeProviderId: GOOGLE_OAUTH_RUNTIME_PROVIDER,
      runtimeOnlyCatalog: true,
    };
  }

  return {
    runtimeProviderId: getOpenClawProviderKeyForType(account.vendorId, account.id),
    runtimeOnlyCatalog: false,
  };
}

export async function resolveLocalModelRuntimeConfig(
  providerService: ProviderService,
): Promise<{ baseUrl?: string; apiProtocol?: string } | null> {
  const accounts = await providerService.listAccounts();
  const localAccount = accounts.find((account) => (
    account.vendorId === 'custom'
    && (account.metadata?.localModel || account.metadata?.managedBy === 'preset-local-model')
    && account.baseUrl
  ));
  if (localAccount?.baseUrl) {
    return {
      baseUrl: localAccount.baseUrl,
      apiProtocol: localAccount.apiProtocol || 'openai-completions',
    };
  }

  const presets = await readLocalModelPresets().catch(() => []);
  const primaryPreset = presets[0];
  if (!primaryPreset?.baseUrl) {
    return null;
  }

  return {
    baseUrl: primaryPreset.baseUrl,
    apiProtocol: primaryPreset.apiProtocol || 'openai-completions',
  };
}

export function shouldDeferRuntimeModelQueries(ctx: HostApiContext): boolean {
  const gatewayState = ctx.gatewayManager.getStatus().state;
  return gatewayState !== 'running' || ctx.gatewayManager.isInStartupStabilizationWindow();
}
