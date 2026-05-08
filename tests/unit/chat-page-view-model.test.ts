import { describe, expect, it } from 'vitest';
import {
  buildChatRuntimeViewModel,
  resolveChatModelState,
} from '@/pages/Chat/chat-page-view-model';

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

describe('buildChatRuntimeViewModel', () => {
  it('keeps existing transcript visible while session hydration recovers in the background', () => {
    const view = buildChatRuntimeViewModel({
      messages: [
        {
          role: 'assistant',
          content: 'Existing answer',
          timestamp: Date.now(),
        },
      ],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      sending: false,
      showThinking: false,
      streamingMessage: null,
      streamingTimestamp: 0,
      currentSessionKey: 'agent:main:session-1',
      currentSession: { key: 'agent:main:session-1', displayName: 'session-1' },
      pendingLocalSessionKeys: {},
      loading: false,
      sessionsHydrated: false,
      isGatewayRunning: true,
      defaultSessionKey: 'agent:main:main',
    });

    expect(view.hasRenderableContent).toBe(true);
    expect(view.isRestoringSessions).toBe(false);
    expect(view.shouldShowLoadingState).toBe(false);
  });

  it('shows restoring state only when no transcript or optimistic content is available', () => {
    const view = buildChatRuntimeViewModel({
      messages: [],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      sending: false,
      showThinking: false,
      streamingMessage: null,
      streamingTimestamp: 0,
      currentSessionKey: 'agent:main:main',
      currentSession: undefined,
      pendingLocalSessionKeys: {},
      loading: false,
      sessionsHydrated: false,
      isGatewayRunning: true,
      defaultSessionKey: 'agent:main:main',
    });

    expect(view.hasRenderableContent).toBe(false);
    expect(view.isRestoringSessions).toBe(true);
    expect(view.shouldShowLoadingState).toBe(true);
  });
});
