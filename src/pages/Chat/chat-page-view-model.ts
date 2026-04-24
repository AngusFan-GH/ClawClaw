import type { ChatAgentOption } from './ChatInput';
import type { ChatToolbarModelOption } from './ChatToolbar';
import type { ChatSession, RawMessage } from '@/stores/chat';
import {
  normalizeModelRefValue,
  normalizeSessionModelValue,
} from './chat-model-options';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';

type AgentRecord = {
  gateway: {
    id: string;
    name?: string;
    isDefault?: boolean;
    identity?: {
      name?: string;
    };
  };
  local: {
    modelRef?: string;
  };
};

export function resolveAgentDisplayName(agent: AgentRecord): string {
  return agent.gateway.name?.trim() || agent.gateway.identity?.name?.trim() || agent.gateway.id;
}

export function resolveEffectiveAgentModelRef(params: {
  agents: AgentRecord[];
  sessionAgentId?: string;
  currentAgentId?: string;
  defaultAgentId?: string;
}): string | undefined {
  const resolvedAgentId = params.sessionAgentId || params.currentAgentId || params.defaultAgentId;
  return params.agents.find((agent) => agent.gateway.id === resolvedAgentId)?.local.modelRef;
}

export function buildAgentOptions(agents: AgentRecord[]): ChatAgentOption[] {
  const sorted = [...agents].sort((left, right) => {
    if (left.gateway.isDefault) return -1;
    if (right.gateway.isDefault) return 1;
    return resolveAgentDisplayName(left).localeCompare(resolveAgentDisplayName(right));
  });
  return sorted.map((agent) => ({
    id: agent.gateway.id,
    label: resolveAgentDisplayName(agent),
  }));
}

export function resolveCurrentAgentLabel(params: {
  agentOptions: ChatAgentOption[];
  agents: AgentRecord[];
  currentAgentId?: string;
  sessionAgentId?: string;
  defaultAgentId?: string;
}): string {
  const { agentOptions, agents, currentAgentId, sessionAgentId, defaultAgentId } = params;

  const resolveAgentName = (agentId?: string) => {
    if (!agentId) return undefined;
    const normalizedId = agentId === 'main' ? defaultAgentId : agentId;
    return (
      agentOptions.find((option) => option.id === normalizedId)?.label
      || agents.find((agent) => agent.gateway.id === normalizedId)?.gateway.name
    );
  };

  return (
    resolveAgentName(sessionAgentId)
    || resolveAgentName(currentAgentId)
    || (sessionAgentId && sessionAgentId !== 'main' ? sessionAgentId : undefined)
    || (currentAgentId && currentAgentId !== 'main' ? currentAgentId : undefined)
    || resolveAgentName(defaultAgentId)
    || 'Main'
  );
}

export function resolveChatModelState(params: {
  isGatewayRunning: boolean;
  currentSessionModel?: string;
  normalizedSelectedModel?: string;
  defaultModelValue?: string;
  modelOptions: ChatToolbarModelOption[];
  modelCatalogSyncing?: boolean;
}): 'disabled' | 'syncing' | 'invalid' | 'ready' | 'unconfigured' {
  const {
    isGatewayRunning,
    currentSessionModel,
    normalizedSelectedModel,
    defaultModelValue,
    modelOptions,
    modelCatalogSyncing = false,
  } = params;

  const currentSessionHasModel = Boolean(currentSessionModel?.trim());
  const hasFallbackModel = Boolean(defaultModelValue?.trim());
  const currentModelInvalid = currentSessionHasModel && !normalizedSelectedModel && modelOptions.length > 0;

  if (!isGatewayRunning) {
    return 'disabled';
  }
  if (modelCatalogSyncing && modelOptions.length === 0) {
    return 'syncing';
  }
  if (currentModelInvalid) {
    return 'invalid';
  }
  if (modelOptions.length > 0) {
    return 'ready';
  }
  if (currentSessionHasModel || hasFallbackModel) {
    return 'invalid';
  }
  return 'unconfigured';
}

export function resolveFallbackModelValue(params: {
  normalizedAgentModelValue?: string;
  normalizedSelectedModel?: string;
  modelOptions: ChatToolbarModelOption[];
}): string | undefined {
  const { normalizedAgentModelValue, normalizedSelectedModel, modelOptions } = params;
  return normalizedSelectedModel || normalizedAgentModelValue || modelOptions[0]?.value;
}

export function normalizeSelectedModelValue(
  currentSession: { model?: string; modelProvider?: string } | undefined,
  modelOptions: ChatToolbarModelOption[],
): string | undefined {
  return normalizeSessionModelValue(currentSession, modelOptions);
}

export function normalizeAgentModelValue(
  effectiveAgentModelRef: string | undefined,
  modelOptions: ChatToolbarModelOption[],
): string | undefined {
  return normalizeModelRefValue(effectiveAgentModelRef, modelOptions);
}

export function buildChatRuntimeViewModel(params: {
  messages: RawMessage[];
  pendingUserMessage: RawMessage | null;
  pendingAssistantMessage: RawMessage | null;
  sending: boolean;
  showThinking: boolean;
  streamingMessage: unknown | null;
  streamingTimestamp: number;
  currentSessionKey: string;
  currentSession: ChatSession | undefined;
  pendingLocalSessionKeys: Record<string, true>;
  loading: boolean;
  sessionsLoading: boolean;
  sessionsHydrated: boolean;
  isGatewayRunning: boolean;
  defaultSessionKey: string;
}): {
  liveStreamingMessage: RawMessage | null;
  isRestoringSessions: boolean;
  isEmpty: boolean;
  currentSessionIsPlaceholder: boolean;
  shouldShowWelcome: boolean;
} {
  const {
    messages,
    pendingUserMessage,
    pendingAssistantMessage,
    sending,
    showThinking,
    streamingMessage,
    streamingTimestamp,
    currentSessionKey,
    currentSession,
    pendingLocalSessionKeys,
    loading,
    sessionsLoading,
    sessionsHydrated,
    isGatewayRunning,
    defaultSessionKey,
  } = params;

  const streamMsg =
    streamingMessage && typeof streamingMessage === 'object'
      ? (streamingMessage as { role?: string; content?: unknown; timestamp?: number })
      : null;
  const streamText = streamMsg
    ? extractText(streamMsg)
    : typeof streamingMessage === 'string'
      ? streamingMessage
      : '';
  const hasStreamText = streamText.trim().length > 0;
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
  const streamTools = streamMsg ? extractToolUse(streamMsg) : [];
  const hasStreamTools = streamTools.length > 0;
  const streamImages = streamMsg ? extractImages(streamMsg) : [];
  const hasStreamImages = streamImages.length > 0;
  const shouldRenderStreaming =
    sending && (hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages);
  const liveStreamingMessage = shouldRenderStreaming
    ? ((streamMsg
        ? {
            ...(streamMsg as Record<string, unknown>),
            role: (typeof streamMsg.role === 'string'
              ? streamMsg.role
              : 'assistant') as RawMessage['role'],
            content: streamMsg.content ?? streamText,
            timestamp: streamMsg.timestamp ?? streamingTimestamp,
          }
        : {
            role: 'assistant',
            content: streamText,
            timestamp: streamingTimestamp,
          }) as RawMessage)
    : null;

  const isRestoringSessions = isGatewayRunning && (sessionsLoading || !sessionsHydrated);
  const hasOptimisticContent = Boolean(
    pendingUserMessage
    || pendingAssistantMessage
    || liveStreamingMessage,
  );
  const isEmpty = messages.length === 0 && !hasOptimisticContent && !loading && !sending && !isRestoringSessions;
  const currentSessionIsPlaceholder =
    (Boolean(pendingLocalSessionKeys[currentSessionKey]) && !hasOptimisticContent)
    || (isEmpty && currentSessionKey === defaultSessionKey);
  const shouldShowWelcome = isEmpty && (!currentSession || currentSessionIsPlaceholder);

  return {
    liveStreamingMessage,
    isRestoringSessions,
    isEmpty,
    currentSessionIsPlaceholder,
    shouldShowWelcome,
  };
}
