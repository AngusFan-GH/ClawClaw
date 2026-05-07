import { describe, expect, it } from 'vitest';
import { resolveChatModelState } from '@/pages/Chat/chat-page-view-model';

describe('resolveChatModelState', () => {
  it('returns ready when a fallback model is available even if the current session model no longer resolves', () => {
    expect(resolveChatModelState({
      isGatewayRunning: true,
      currentSessionModel: 'custom-provider/stale-model',
      normalizedSelectedModel: undefined,
      defaultModelValue: 'openai/gpt-5.5',
      modelOptions: [
        { value: 'openai/gpt-5.5', label: 'OpenAI · gpt-5.5', shortLabel: 'gpt-5.5' },
      ],
      modelCatalogSyncing: false,
    })).toBe('ready');
  });

  it('returns invalid when the current session model no longer resolves and no fallback model exists', () => {
    expect(resolveChatModelState({
      isGatewayRunning: true,
      currentSessionModel: 'custom-provider/stale-model',
      normalizedSelectedModel: undefined,
      defaultModelValue: undefined,
      modelOptions: [
        { value: 'openai/gpt-5.5', label: 'OpenAI · gpt-5.5', shortLabel: 'gpt-5.5' },
      ],
      modelCatalogSyncing: false,
    })).toBe('invalid');
  });
});
