import { CoreProviderStore } from './provider-store';
import type { ModelTurn } from './model-adapter';

const API_BY_VENDOR: Record<string, string> = {
  openai: 'openai-responses',
  anthropic: 'anthropic-messages',
  'minimax-portal': 'anthropic-messages',
  'minimax-portal-cn': 'anthropic-messages',
};

/** Resolves ClawClaw account records into a direct model route without Gateway configuration. */
export class CoreProviderResolver {
  constructor(private readonly providers: CoreProviderStore) {}
  async resolve(accountId?: string): Promise<ModelTurn['model']> {
    const account = accountId ? this.providers.get(accountId) : this.providers.getDefault();
    if (!account || !account.enabled) throw new Error('Configured model provider is unavailable');
    const model = account.model;
    if (!model) throw new Error('No model configured for provider');
    const apiKey = await this.providers.getApiKey(account.id);
    if (account.authMode !== 'local' && !apiKey) throw new Error('Provider API key is missing');
    return {
      provider: account.vendorId,
      id: model,
      apiKey: apiKey || undefined,
      baseUrl: account.baseUrl,
      api: account.apiProtocol || API_BY_VENDOR[account.vendorId] || 'openai-completions',
    };
  }
}
