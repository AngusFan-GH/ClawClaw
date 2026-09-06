/**
 * Resolves a provider account into a direct model route.
 *
 * The route carries the credential only at execution time; it is never stored
 * in SQLite, run events, messages, logs or renderer state. Gateway/OpenClaw
 * configuration is never consulted.
 */
import { fail } from './errors';
import { getVendor } from './provider-catalog';
import type { ProviderStore } from './provider-store';

export interface ResolvedModelRoute {
  vendorId: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  api: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  headers?: Record<string, string>;
}

export class CoreProviderResolver {
  constructor(private readonly providers: ProviderStore) {}

  async resolve(workspaceId = 'default', accountId?: string): Promise<ResolvedModelRoute> {
    return this.resolveRoute(workspaceId, { accountId });
  }

  async resolveRoute(
    workspaceId = 'default',
    options: { accountId?: string; modelOverride?: string | null } = {},
  ): Promise<ResolvedModelRoute> {
    const row = options.accountId
      ? this.providers.getRow(workspaceId, options.accountId)
      : this.providers.getDefault(workspaceId);
    if (!row) fail('PROVIDER_NO_DEFAULT', 'No model provider is configured');
    if (!row.enabled) fail('PROVIDER_DISABLED', 'The selected provider is disabled');

    const apiKey = await this.providers.getSecret(workspaceId, row.id);
    if (row.auth_mode === 'api_key' && !apiKey) {
      fail('PROVIDER_SECRET_MISSING', 'Provider API key is missing');
    }
    const model = (options.modelOverride ?? row.model ?? '').trim();
    if (!model) fail('PROVIDER_NO_MODEL', 'No model selected for this provider');

    const vendor = getVendor(row.vendor_id);
    const route: ResolvedModelRoute = {
      vendorId: row.vendor_id,
      model,
      baseUrl: row.base_url ?? vendor.defaultBaseUrl,
      api: (row.api_protocol as ResolvedModelRoute['api']) ?? vendor.protocol,
      headers: vendorHeaders(row.vendor_id),
    };
    if (apiKey) route.apiKey = apiKey;
    return route;
  }
}

function vendorHeaders(vendorId: string): Record<string, string> | undefined {
  if (vendorId === 'openrouter') {
    return { 'HTTP-Referer': 'https://clawclaw.local', 'X-Title': 'ClawClaw' };
  }
  return undefined;
}
