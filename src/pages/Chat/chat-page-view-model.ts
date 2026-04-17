import type { ChatAgentOption } from './ChatInput';
import type { ChatToolbarModelOption } from './ChatToolbar';
import type { ProviderAccount, ProviderVendorInfo } from '@/lib/providers';
import type { ChatSession, RawMessage } from '@/stores/chat';
import {
  dedupeModelOptions,
  getProviderDisplayName,
  isMultiInstanceRuntimeVendor,
  isStrictRuntimeCatalogAccount,
  normalizeModelRefValue,
  normalizeSessionModelValue,
  resolveAccountCatalogModelOptions,
  resolveAccountModelLabel,
  resolveAccountModelOptions,
  type ProviderCatalogResponse,
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

export function buildConfiguredModelOptions(params: {
  eligibleAccounts: ProviderAccount[];
  vendorMap: Map<string, ProviderVendorInfo>;
  providerCatalogMap: Record<string, ProviderCatalogResponse>;
}): ChatToolbarModelOption[] {
  const { eligibleAccounts, vendorMap, providerCatalogMap } = params;
  return eligibleAccounts
    .flatMap((account) => {
      const vendor = vendorMap.get(account.vendorId);
      const providerDisplayName = getProviderDisplayName(account, vendor);
      const catalog = providerCatalogMap[account.id];
      const strictRuntimeCatalog = isStrictRuntimeCatalogAccount(account);
      if (isMultiInstanceRuntimeVendor(account.vendorId)) {
        if (!catalog?.resolved || !catalog.runtimeProviderId) {
          return [];
        }
        return resolveAccountCatalogModelOptions(account, providerDisplayName, catalog);
      }
      const catalogOptions = resolveAccountCatalogModelOptions(account, providerDisplayName, catalog);
      const explicitOptions = resolveAccountModelOptions(
        account,
        vendor,
        providerDisplayName,
        catalog?.runtimeProviderId,
      );
      if (strictRuntimeCatalog) {
        return catalogOptions.length > 0 ? catalogOptions : explicitOptions;
      }
      if (catalog?.resolved) {
        return catalogOptions;
      }
      return explicitOptions;
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function buildPrioritizedModelOptions(
  configuredModelOptions: ChatToolbarModelOption[],
  runtimeModelRefs: string[],
): ChatToolbarModelOption[] {
  const deduped = dedupeModelOptions(configuredModelOptions);
  const runtimeSet = new Set(runtimeModelRefs);
  const runtimeFiltered = deduped.filter((option) => runtimeSet.has(option.value));
  if (runtimeFiltered.length === 0) {
    return deduped;
  }
  return dedupeModelOptions([
    ...runtimeFiltered,
    ...deduped.filter((option) => !runtimeSet.has(option.value)),
  ]);
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

export function resolveDefaultModelMeta(params: {
  defaultAccountId?: string | null;
  providerAccounts: ProviderAccount[];
  vendorMap: Map<string, ProviderVendorInfo>;
  providerCatalogMap: Record<string, ProviderCatalogResponse>;
  modelOptions: ChatToolbarModelOption[];
}): { label?: string; shortLabel?: string; value?: string } {
  const { defaultAccountId, providerAccounts, vendorMap, providerCatalogMap, modelOptions } = params;
  const defaultAccount = providerAccounts.find((account) => account.id === defaultAccountId);
  if (!defaultAccount) {
    return {
      label: modelOptions[0]?.label,
      value: modelOptions[0]?.value,
    };
  }

  const vendor = vendorMap.get(defaultAccount.vendorId);
  const providerDisplayName = getProviderDisplayName(defaultAccount, vendor);
  const defaultCatalog = providerCatalogMap[defaultAccount.id];
  const { modelName, modelRef } = resolveAccountModelLabel(
    defaultAccount,
    vendor,
    defaultCatalog?.runtimeProviderId,
  );
  return {
    label: `${providerDisplayName} · ${modelName || modelRef || providerDisplayName}`,
    shortLabel: modelName || modelRef || defaultAccount.label,
    value: modelRef,
  };
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
  configuredModelOptions: ChatToolbarModelOption[];
  currentSessionModel?: string;
  normalizedSelectedModel?: string;
  modelOptions: ChatToolbarModelOption[];
  eligibleAccounts: ProviderAccount[];
  modelCatalogSyncing?: boolean;
}): 'disabled' | 'syncing' | 'invalid' | 'ready' | 'unconfigured' {
  const {
    isGatewayRunning,
    configuredModelOptions,
    currentSessionModel,
    normalizedSelectedModel,
    modelOptions,
    eligibleAccounts,
    modelCatalogSyncing = false,
  } = params;

  const hasAnyConfiguredModels = configuredModelOptions.length > 0;
  const currentSessionHasModel = Boolean(currentSessionModel?.trim());
  const currentModelInvalid = currentSessionHasModel && !normalizedSelectedModel && modelOptions.length > 0;

  if (!isGatewayRunning) {
    return 'disabled';
  }
  if (modelCatalogSyncing && !hasAnyConfiguredModels) {
    return 'syncing';
  }
  if (currentModelInvalid) {
    return 'invalid';
  }
  if (modelOptions.length > 0) {
    return 'ready';
  }
  if (eligibleAccounts.length > 0) {
    return 'syncing';
  }
  return 'unconfigured';
}

export function normalizeDefaultModelValue(params: {
  normalizedAgentModelValue?: string;
  defaultModelValue?: string;
  modelOptions: ChatToolbarModelOption[];
}): string | undefined {
  const { normalizedAgentModelValue, defaultModelValue, modelOptions } = params;
  return normalizedAgentModelValue || normalizeSessionModelValue(
    defaultModelValue ? { model: defaultModelValue } : undefined,
    modelOptions,
  );
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
  const isEmpty = messages.length === 0 && !loading && !sending && !isRestoringSessions;
  const currentSessionIsPlaceholder =
    Boolean(pendingLocalSessionKeys[currentSessionKey])
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
