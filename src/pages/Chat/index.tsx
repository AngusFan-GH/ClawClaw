/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Brain, Check, ChevronDown, Loader2 } from 'lucide-react';
import { DEFAULT_SESSION_KEY, useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useAgentsStore } from '@/stores/agents';
import { PageLoader } from '@/components/common/LoadingSpinner';
import { ChatThread } from './ChatThread';
import { ChatInput, type ChatAgentOption, type FileAttachment } from './ChatInput';
import { ChatToolbar, type ChatToolbarModelOption } from './ChatToolbar';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  isMultiInstanceProviderType,
  PROVIDER_TYPE_INFO,
  type ProviderAccount,
  type ProviderVendorInfo,
} from '@/lib/providers';
import { useLocation, useNavigate } from 'react-router-dom';
import { hostApiFetch } from '@/lib/host-api';
import i18n from '@/i18n';

function getRuntimeProviderFallbackKey(account: ProviderAccount): string | undefined {
  if (account.vendorId === 'google' && account.authMode === 'oauth_browser') {
    return 'google-gemini-cli';
  }
  if (
    account.vendorId === 'openai' &&
    (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device')
  ) {
    return 'openai-codex';
  }
  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  if (isMultiInstanceProviderType(account.vendorId)) {
    return undefined;
  }
  return account.vendorId;
}

function normalizeAccountModel(account: ProviderAccount, model?: string): string | undefined {
  if (
    account.vendorId === 'openai'
    && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device')
    && (model === 'gpt-5.2' || model === 'gpt-5.3-codex')
  ) {
    return 'gpt-5.4';
  }
  return model;
}

function resolveAccountModelLabel(
  account: ProviderAccount,
  vendor: ProviderVendorInfo | undefined,
  runtimeProviderId?: string,
): { modelRef?: string; modelName?: string } {
  const runtimeProviderKey = runtimeProviderId || getRuntimeProviderFallbackKey(account);
  const fallbackVendor = PROVIDER_TYPE_INFO.find((item) => item.id === account.vendorId);
  const rawModel = normalizeAccountModel(
    account,
    account.model || vendor?.defaultModelId || fallbackVendor?.defaultModelId,
  );

  if (!rawModel) {
    return {
      modelName: vendor?.model || fallbackVendor?.model || account.label,
    };
  }

  return {
    modelRef: runtimeProviderKey
      ? (rawModel.startsWith(`${runtimeProviderKey}/`) ? rawModel : `${runtimeProviderKey}/${rawModel}`)
      : rawModel,
    modelName: rawModel.split('/').pop() || rawModel,
  };
}

function resolveAccountModelOptions(
  account: ProviderAccount,
  vendor: ProviderVendorInfo | undefined,
  providerDisplayName: string,
  runtimeProviderId?: string,
): ChatToolbarModelOption[] {
  const runtimeProviderKey = runtimeProviderId || getRuntimeProviderFallbackKey(account);
  const fallbackVendor = PROVIDER_TYPE_INFO.find((item) => item.id === account.vendorId);
  const primaryModel = normalizeAccountModel(
    account,
    account.model || vendor?.defaultModelId || fallbackVendor?.defaultModelId,
  );
  const candidates = [primaryModel, ...(account.fallbackModels ?? [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const seen = new Set<string>();

  return candidates.flatMap((candidate) => {
    const normalizedRef = runtimeProviderKey
      ? (candidate.startsWith(`${runtimeProviderKey}/`) ? candidate : `${runtimeProviderKey}/${candidate}`)
      : candidate;
    if (seen.has(normalizedRef)) {
      return [];
    }
    seen.add(normalizedRef);
    const modelName = normalizedRef.split('/').pop() || normalizedRef;
    return [{
      value: normalizedRef,
      label: `${providerDisplayName} · ${modelName}`,
      shortLabel: modelName,
    }];
  });
}

function isMultiInstanceRuntimeVendor(vendorId: ProviderAccount['vendorId']): boolean {
  return isMultiInstanceProviderType(vendorId);
}

function isLocalModelProviderAccount(account: Pick<ProviderAccount, 'vendorId' | 'metadata'>): boolean {
  return account.vendorId === 'local-model' && account.metadata?.localModelProvider === true;
}

function getProviderDisplayName(account: ProviderAccount, vendor?: ProviderVendorInfo): string {
  if (
    account.vendorId === 'local-model'
    || account.metadata?.localModel
    || account.metadata?.managedBy === 'preset-local-model'
  ) {
    return i18n.t('chat:composer.localModelProvider', '本地模型');
  }
  return account.label || vendor?.name || account.vendorId;
}

type ProviderCatalogModelOption = {
  id: string;
  name: string;
};

type ProviderCatalogResponse = {
  runtimeProviderId?: string;
  models: ProviderCatalogModelOption[];
  resolved?: boolean;
  source?: 'runtime' | 'models_json_fallback' | 'direct';
};

function isStrictRuntimeCatalogAccount(account: ProviderAccount): boolean {
  return (
    (account.vendorId === 'openai' && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device'))
    || (account.vendorId === 'google' && account.authMode === 'oauth_browser')
  );
}

function resolveAccountCatalogModelOptions(
  account: ProviderAccount,
  providerDisplayName: string,
  catalog: ProviderCatalogResponse | undefined,
): ChatToolbarModelOption[] {
  const runtimeProviderKey = catalog?.runtimeProviderId || getRuntimeProviderFallbackKey(account);
  const seen = new Set<string>();
  const models = catalog?.models ?? [];

  return models.flatMap((candidate) => {
    const normalizedId = normalizeAccountModel(account, candidate.id)?.trim();
    if (!normalizedId) {
      return [];
    }

    const normalizedRef = runtimeProviderKey
      ? (normalizedId.startsWith(`${runtimeProviderKey}/`) ? normalizedId : `${runtimeProviderKey}/${normalizedId}`)
      : normalizedId;
    if (seen.has(normalizedRef)) {
      return [];
    }
    seen.add(normalizedRef);

    const displayName = candidate.name?.trim() || normalizedId.split('/').pop() || normalizedId;
    return [{
      value: normalizedRef,
      label: `${providerDisplayName} · ${displayName}`,
      shortLabel: displayName,
    }];
  });
}

function normalizeSessionModelValue(
  session: { model?: string; modelProvider?: string } | undefined,
  options: ChatToolbarModelOption[]
): string | undefined {
  const currentModel = session?.model?.trim();
  if (!currentModel) return undefined;
  const exact = options.find((option) => option.value === currentModel);
  if (exact) return exact.value;

  const provider = session?.modelProvider?.trim();
  if (provider && !currentModel.includes('/')) {
    const withProvider = `${provider}/${currentModel}`;
    const byProvider = options.find((option) => option.value === withProvider);
    if (byProvider) return byProvider.value;
  }

  const suffixMatches = options.filter((option) => option.value.split('/').pop() === currentModel);
  if (suffixMatches.length === 1) {
    return suffixMatches[0].value;
  }

  return undefined;
}

function normalizeModelRefValue(
  modelRef: string | undefined,
  options: ChatToolbarModelOption[],
): string | undefined {
  if (!modelRef?.trim()) return undefined;
  return normalizeSessionModelValue({ model: modelRef }, options);
}

function dedupeModelOptions(options: ChatToolbarModelOption[]): ChatToolbarModelOption[] {
  const seenValues = new Set<string>();

  return options.filter((option) => {
    const valueKey = option.value.trim().toLowerCase();
    if (seenValues.has(valueKey)) {
      return false;
    }
    seenValues.add(valueKey);
    return true;
  });
}

function getAgentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  const key = sessionKey?.trim();
  if (!key || !key.startsWith('agent:')) return undefined;
  const parts = key.split(':');
  return parts[1]?.trim() || undefined;
}

function resolveAgentDisplayName(agent: { gateway: { id: string; name?: string; identity?: { name?: string } } }): string {
  return agent.gateway.name?.trim() || agent.gateway.identity?.name?.trim() || agent.gateway.id;
}

export function Chat() {
  useEffect(() => {
    console.debug('[chat] Chat component mounted');
    return () => console.debug('[chat] Chat component unmounted');
  }, []);
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const location = useLocation();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const gatewayInitialized = useGatewayStore((s) => s.isInitialized);
  const displayGatewayState = gatewayInitialized ? gatewayStatus.state : 'starting';
  const isGatewayRunning = displayGatewayState === 'running';

  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const sessions = useChatStore((s) => s.sessions);
  const sessionsLoading = useChatStore((s) => s.sessionsLoading);
  const sessionsHydrated = useChatStore((s) => s.sessionsHydrated);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const pendingLocalSessionKeys = useChatStore((s) => s.pendingLocalSessionKeys);
  const historyWindowLimited = useChatStore((s) => s.historyWindowLimited);
  const hasEarlierHistory = useChatStore((s) => s.hasEarlierHistory);
  const loadingEarlierHistory = useChatStore((s) => s.loadingEarlierHistory);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const chatToolMessages = useChatStore((s) => s.chatToolMessages);
  const chatStreamSegments = useChatStore((s) => s.chatStreamSegments);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const compactionStatus = useChatStore((s) => s.compactionStatus);
  const fallbackStatus = useChatStore((s) => s.fallbackStatus);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const loadEarlierHistory = useChatStore((s) => s.loadEarlierHistory);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const restoreSessionsAfterGatewayReady = useChatStore((s) => s.restoreSessionsAfterGatewayReady);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const setSessionModel = useChatStore((s) => s.setSessionModel);
  const setModelGuard = useChatStore((s) => s.setModelGuard);
  const toggleThinking = useChatStore((s) => s.toggleThinking);

  const agents = useAgentsStore((s) => s.agents);
  const defaultAgentId = useAgentsStore((s) => s.defaultAgentId);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerVendors = useProviderStore((s) => s.vendors);
  const defaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const [providerCatalogMap, setProviderCatalogMap] = useState<Record<string, ProviderCatalogResponse>>({});
  const [runtimeModelRefs, setRuntimeModelRefs] = useState<string[] | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const pendingPrependScrollRef = useRef<{ height: number; top: number } | null>(null);
  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const currentSession = sessions.find((session) => session.key === currentSessionKey);
  const sessionAgentId = useMemo(
    () => getAgentIdFromSessionKey(currentSessionKey) || getAgentIdFromSessionKey(currentSession?.key),
    [currentSession?.key, currentSessionKey]
  );
  const providerStatusMap = useMemo(
    () => new Map((providerStatuses ?? []).map((status) => [status.id, status])),
    [providerStatuses]
  );
  const vendorMap = useMemo(
    () => new Map((providerVendors ?? []).map((vendor) => [vendor.id, vendor])),
    [providerVendors]
  );
  const forceSessionKeyFromRoute = useMemo(() => {
    const state = location.state as { forceSessionKey?: string } | null;
    const candidate = state?.forceSessionKey;
    return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
  }, [location.state]);
  const createNewSessionFromRoute = useMemo(() => {
    const state = location.state as { createNewSession?: boolean } | null;
    return state?.createNewSession === true;
  }, [location.state]);

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages → spinner → messages flicker.
  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    (async () => {
      if (createNewSessionFromRoute) {
        newSession();
        navigate(location.pathname, { replace: true, state: null });
        if (!cancelled) {
          void loadSessions({ preserveCurrent: true });
        }
        return;
      }

      if (forceSessionKeyFromRoute) {
        if (forceSessionKeyFromRoute !== useChatStore.getState().currentSessionKey) {
          switchSession(forceSessionKeyFromRoute);
        }
        navigate(location.pathname, { replace: true, state: null });
        await loadHistory(false);
        if (!cancelled) {
          void loadSessions({ preserveCurrent: true });
        }
        return;
      }

      if (!sessionsHydrated) {
        await restoreSessionsAfterGatewayReady();
      } else {
        await loadHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isGatewayRunning,
    loadHistory,
    loadSessions,
    newSession,
    restoreSessionsAfterGatewayReady,
    sessionsHydrated,
    createNewSessionFromRoute,
    forceSessionKeyFromRoute,
    switchSession,
    navigate,
    location.pathname,
  ]);

  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (!isGatewayRunning) {
      queueMicrotask(() => {
        setRuntimeModelRefs(null);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setRuntimeModelRefs(null);
      }
    });
    hostApiFetch<{ models?: string[] }>('/api/runtime-model-refs')
      .then((response) => {
        if (cancelled) return;
        setRuntimeModelRefs(Array.isArray(response.models) ? response.models : []);
      })
      .catch((error) => {
        console.warn('Failed to load runtime model refs:', error);
        if (!cancelled) setRuntimeModelRefs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isGatewayRunning, providerAccounts, providerStatuses]);

  const eligibleAccounts = useMemo(
    () => providerAccounts.filter((account) => account.enabled)
      .filter((account) => !isLocalModelProviderAccount(account))
      .filter(
        (account) =>
          account.authMode === 'local'
          || account.authMode === 'oauth_device'
          || account.authMode === 'oauth_browser'
          || Boolean(providerStatusMap.get(account.id)?.hasKey),
      ),
    [providerAccounts, providerStatusMap]
  );

  useEffect(() => {
    let cancelled = false;
    const requestKeys = eligibleAccounts.map((account) => account.id);

    if (requestKeys.length === 0) {
      queueMicrotask(() => {
        if (!cancelled) {
          setProviderCatalogMap({});
        }
      });
      return;
    }

    Promise.all(requestKeys.map(async (accountId) => {
      const account = eligibleAccounts.find((item) => item.id === accountId);
      if (!account) {
        return [accountId, { runtimeProviderId: undefined, models: [] }] as const;
      }
      try {
        const response = await hostApiFetch<ProviderCatalogResponse>(
          `/api/provider-model-options?vendorId=${encodeURIComponent(account.vendorId)}&authMode=${encodeURIComponent(account.authMode)}&accountId=${encodeURIComponent(account.id)}&scope=runtime`,
        );
        return [accountId, {
          runtimeProviderId: response.runtimeProviderId,
          models: response.models ?? [],
          resolved: true,
        }] as const;
      } catch (error) {
        console.warn(`Failed to load provider model options for ${accountId}:`, error);
        return [accountId, {
          runtimeProviderId: getRuntimeProviderFallbackKey(account),
          models: [],
          resolved: false,
        }] as const;
      }
    })).then((entries) => {
      if (cancelled) return;
      setProviderCatalogMap(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [eligibleAccounts]);

  // Auto-scroll on new messages, streaming, or activity changes when the user is already near the bottom.
  useEffect(() => {
    if (loadingEarlierHistory || !shouldStickToBottomRef.current) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({
      behavior: streamingMessage ? 'auto' : 'smooth',
    });
  }, [messages, streamingMessage, sending, pendingFinal, loadingEarlierHistory]);

  useLayoutEffect(() => {
    const pending = pendingPrependScrollRef.current;
    const viewport = scrollViewportRef.current;
    if (!pending || !viewport || loadingEarlierHistory) {
      return;
    }
    const delta = viewport.scrollHeight - pending.height;
    viewport.scrollTop = pending.top + Math.max(0, delta);
    pendingPrependScrollRef.current = null;
  }, [messages, loadingEarlierHistory]);

  useEffect(() => {
    if (!loadingEarlierHistory) {
      pendingPrependScrollRef.current = null;
    }
  }, [loadingEarlierHistory]);

  const handleMessagesScroll = (): void => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 120;

    if (
      viewport.scrollTop <= 96
      && hasEarlierHistory
      && !loadingEarlierHistory
    ) {
      pendingPrependScrollRef.current = {
        height: viewport.scrollHeight,
        top: viewport.scrollTop,
      };
      void loadEarlierHistory();
    }
  };

  // Update timestamp when sending starts
  useEffect(() => {
    if (sending && streamingTimestamp === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStreamingTimestamp(Date.now() / 1000);
    } else if (!sending && streamingTimestamp !== 0) {
      setStreamingTimestamp(0);
    }
  }, [sending, streamingTimestamp]);

  // Gateway not running block has been completely removed so the UI always renders.

  const streamMsg =
    streamingMessage && typeof streamingMessage === 'object'
      ? (streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number })
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
    sending &&
    (hasStreamText ||
      hasStreamThinking ||
      hasStreamTools ||
      hasStreamImages);
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
    || (isEmpty && currentSessionKey === DEFAULT_SESSION_KEY);
  const shouldShowWelcome = isEmpty && (!currentSession || currentSessionIsPlaceholder);
  const configuredModelOptions = useMemo<ChatToolbarModelOption[]>(() => {
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
  }, [eligibleAccounts, providerCatalogMap, vendorMap]);

  const modelOptions = useMemo<ChatToolbarModelOption[]>(() => {
    const deduped = dedupeModelOptions(configuredModelOptions);
    if (runtimeModelRefs === null) {
      return deduped;
    }
    const runtimeSet = new Set(runtimeModelRefs);
    const runtimeFiltered = deduped.filter((option) => runtimeSet.has(option.value));
    if (runtimeFiltered.length === 0) {
      return deduped;
    }
    const merged = [
      ...runtimeFiltered,
      ...deduped.filter((option) => !runtimeSet.has(option.value)),
    ];
    return dedupeModelOptions(merged);
  }, [configuredModelOptions, runtimeModelRefs]);
  const normalizedSelectedModel = useMemo(
    () => normalizeSessionModelValue(currentSession, modelOptions),
    [currentSession, modelOptions]
  );
  const effectiveAgentModelRef = useMemo(() => {
    const resolvedAgentId = sessionAgentId || currentAgentId || defaultAgentId;
    return agents.find((agent) => agent.gateway.id === resolvedAgentId)?.local.modelRef;
  }, [agents, currentAgentId, defaultAgentId, sessionAgentId]);
  const normalizedAgentModelValue = useMemo(
    () => normalizeModelRefValue(effectiveAgentModelRef, modelOptions),
    [effectiveAgentModelRef, modelOptions],
  );
  const defaultModelMeta = useMemo(() => {
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
  }, [defaultAccountId, modelOptions, providerAccounts, providerCatalogMap, vendorMap]);
  const normalizedDefaultModelValue = useMemo(
    () => normalizedAgentModelValue || normalizeSessionModelValue(
      defaultModelMeta.value ? { model: defaultModelMeta.value } : undefined,
      modelOptions,
    ),
    [defaultModelMeta.value, modelOptions, normalizedAgentModelValue]
  );
  const agentOptions = useMemo<ChatAgentOption[]>(() => {
    const sorted = [...agents].sort((left, right) => {
      if (left.gateway.isDefault) return -1;
      if (right.gateway.isDefault) return 1;
      return resolveAgentDisplayName(left).localeCompare(resolveAgentDisplayName(right));
    });
    return sorted.map((agent) => ({
      id: agent.gateway.id,
      label: resolveAgentDisplayName(agent),
    }));
  }, [agents]);
  const canSwitchAgent = currentSessionIsPlaceholder;
  const currentAgentLabel = useMemo(
    () => {
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
    },
    [agentOptions, agents, currentAgentId, sessionAgentId, defaultAgentId]
  );

  const resolvedAgentLabel = currentAgentLabel?.trim() || 'Main';
  const resolvedAssistantName = resolvedAgentLabel;

  useEffect(() => {
    const allowed = modelOptions.map((option) => option.value);
    setModelGuard(allowed, normalizedDefaultModelValue);
  }, [modelOptions, normalizedDefaultModelValue, setModelGuard]);

  const modelCatalogSyncing = isGatewayRunning
    && eligibleAccounts.length > 0
    && (
      runtimeModelRefs === null
      || eligibleAccounts.some((account) => !providerCatalogMap[account.id])
    );
  const hasAnyConfiguredModels = configuredModelOptions.length > 0;
  const currentSessionHasModel = Boolean(currentSession?.model?.trim());
  const currentModelInvalid = currentSessionHasModel && !normalizedSelectedModel && modelOptions.length > 0;
  const modelState = !isGatewayRunning
    ? 'disabled'
    : modelCatalogSyncing && !hasAnyConfiguredModels
      ? 'syncing'
      : currentModelInvalid
        ? 'invalid'
        : modelOptions.length > 0
          ? 'ready'
          : eligibleAccounts.length > 0
            ? 'syncing'
            : 'unconfigured';
  const loadingDescription = isGatewayRunning
    ? t('history.loading', '正在恢复最近对话')
    : displayGatewayState === 'starting' || displayGatewayState === 'reconnecting'
      ? t('history.connectingGateway', '网关正在恢复连接')
      : t('history.waitingForGateway', '网关未连接，请启动或重启网关后再试');
  const loadingTitle = isGatewayRunning
    ? t('loading.title', '正在加载对话')
    : displayGatewayState === 'starting'
      ? t('toolbar.gatewayStarting', '正在连接网关')
      : displayGatewayState === 'reconnecting'
        ? t('toolbar.gatewayReconnecting', '网关重连中')
        : t('toolbar.gatewayStopped', '网关未连接');
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col -m-6 overflow-hidden transition-colors duration-500 dark:bg-background'
      )}
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-end px-4 py-2">
        <ChatToolbar
          currentAgentLabel={resolvedAgentLabel}
          showAgentLabel={!shouldShowWelcome && !canSwitchAgent}
        />
      </div>

      {/* Messages Area */}
      <div
        ref={scrollViewportRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        onScroll={handleMessagesScroll}
      >
        <div className="max-w-4xl mx-auto space-y-4">
          {(loading && !sending) || isRestoringSessions ? (
            <PageLoader
              compact
              title={loadingTitle}
              description={loadingDescription}
              className="h-[60vh]"
            />
          ) : shouldShowWelcome ? (
            <WelcomeScreen
              canSwitchAgent={canSwitchAgent}
              currentAgentId={currentAgentId}
              currentAgentLabel={currentAgentLabel}
              agentOptions={agentOptions}
              onAgentChange={(agentId) => {
                if (agentId === currentAgentId) return;
                newSession(agentId);
              }}
            />
          ) : (
            <>
              {compactionStatus && (
                <div
                  className={cn(
                    'compaction-indicator',
                    compactionStatus.active ? 'compaction-indicator--active' : 'compaction-indicator--complete'
                  )}
                >
                  {compactionStatus.active ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  <span>
                    {compactionStatus.active
                      ? t('status.compactingContext', 'Compacting context')
                      : t('status.contextCompacted', 'Context compacted')}
                  </span>
                </div>
              )}

              {fallbackStatus && (
                <div
                  className={cn(
                    'compaction-indicator',
                    fallbackStatus.phase === 'cleared'
                      ? 'compaction-indicator--fallback-cleared'
                      : 'compaction-indicator--fallback'
                  )}
                >
                  {fallbackStatus.phase === 'cleared' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Brain className="h-4 w-4" />
                  )}
                  <span>
                    {fallbackStatus.phase === 'cleared'
                      ? t(
                          'status.fallbackCleared',
                          'Fallback cleared: back on {{model}}',
                          { model: fallbackStatus.active }
                        )
                      : t(
                          'status.fallbackActive',
                          'Fallback active: {{selected}} -> {{active}}',
                          { selected: fallbackStatus.selected, active: fallbackStatus.active }
                        )}
                  </span>
                </div>
              )}

              <ChatThread
                messages={messages}
                toolMessages={chatToolMessages}
                streamSegments={chatStreamSegments}
                streamingMessage={liveStreamingMessage}
                streamingStartedAt={streamingTimestamp}
                sending={sending}
                pendingFinal={pendingFinal}
                showThinking={showThinking}
                sessionKey={currentSessionKey}
                contextWindow={currentSession?.contextTokens ?? null}
                assistantName={resolvedAssistantName}
                historyWindowLimited={historyWindowLimited}
                canLoadEarlier={hasEarlierHistory}
                loadingEarlierHistory={loadingEarlierHistory}
              />

            </>
          )}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
            <button
              onClick={clearError}
              className="text-xs text-destructive/60 hover:text-destructive underline"
            >
              {t('common:actions.dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <ChatInput
        onSend={(text: string, attachments?: FileAttachment[]) => sendMessage(text, attachments)}
        onStop={abortRun}
        onToggleThinking={toggleThinking}
        resetKey={`${currentSessionKey || 'no-session'}:${shouldShowWelcome ? 'welcome' : isEmpty ? 'empty' : 'active'}`}
        modelOptions={modelOptions}
        selectedModel={normalizedSelectedModel || normalizedAgentModelValue}
        defaultModelValue={normalizedDefaultModelValue}
        defaultModelShortLabel={defaultModelMeta.shortLabel}
        onModelChange={setSessionModel}
        onConfigureModels={() => navigate('/models')}
        modelDisabled={!isGatewayRunning}
        modelState={modelState}
        disabled={!isGatewayRunning}
        sending={sending}
        isEmpty={shouldShowWelcome}
        showThinking={showThinking}
      />
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

function WelcomeScreen({
  canSwitchAgent,
  currentAgentId,
  currentAgentLabel,
  agentOptions,
  onAgentChange,
}: {
  canSwitchAgent: boolean;
  currentAgentId?: string;
  currentAgentLabel?: string;
  agentOptions: ChatAgentOption[];
  onAgentChange: (agentId: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const agentTriggerRef = useRef<HTMLButtonElement>(null);
  const [agentMenuPosition, setAgentMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    compact: boolean;
    maxHeight: number;
  } | null>(null);
  useEffect(() => {
    if (!agentMenuOpen) return;

    const updatePosition = () => {
      const rect = agentTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const compact = window.innerWidth < 640;
      setAgentMenuPosition({
        top: compact ? rect.top : rect.bottom + 8,
        left: compact ? rect.left : rect.left + rect.width / 2,
        width: rect.width,
        compact,
        maxHeight: Math.max(220, window.innerHeight - rect.top - 16),
      });
    };

    updatePosition();

    const handlePointerDown = (event: MouseEvent) => {
      if (!agentMenuRef.current?.contains(event.target as Node)) {
        setAgentMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAgentMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [agentMenuOpen]);

  return (
    <div className="flex h-[52vh] flex-col items-center justify-center px-4 text-center sm:h-[58vh]">
      <h1 className="text-[clamp(2.25rem,7vw,3.75rem)] font-semibold leading-[1.08] tracking-[-0.05em] text-foreground">
        {t('welcome.title')}
      </h1>
      <p className="mt-3 max-w-2xl text-[15px] font-medium text-foreground/52 sm:mt-4 sm:text-[18px]">
        {t('welcome.subtitle')}
      </p>

      <div className="mt-8 w-full max-w-[360px] relative sm:mt-10" ref={agentMenuRef}>
        <button
          ref={agentTriggerRef}
          type="button"
          aria-label={t('composer.agentAriaLabel')}
          className={cn(
            'flex w-full items-center gap-3 rounded-[14px] border border-black/10 bg-white/80 px-4 py-3.5 text-left transition-colors hover:border-black/20 hover:bg-white/90 dark:border-white/10 dark:bg-white/[0.05] dark:hover:border-white/20 dark:hover:bg-white/[0.08] sm:gap-4 sm:px-5 sm:py-4',
            agentMenuOpen && agentMenuPosition?.compact && 'invisible'
          )}
          onClick={() => {
            if (canSwitchAgent) {
              setAgentMenuOpen((open) => !open);
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-foreground/40 sm:text-[13px]">
              {t('welcome.agentEyebrow')}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <div className="truncate text-[17px] font-semibold text-foreground sm:text-[18px]">
                {currentAgentLabel}
              </div>
            </div>
          </div>
          {canSwitchAgent ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
        </button>
        {agentMenuOpen && canSwitchAgent && agentMenuPosition
          ? createPortal(
              <div
                ref={agentMenuRef}
                className="fixed z-[120] overflow-hidden rounded-[14px] border border-black/10 bg-card/95 p-1.5 text-left shadow-lg dark:border-white/10 dark:bg-card/95"
                style={{
                  top: agentMenuPosition.top,
                  left: agentMenuPosition.left,
                  width: agentMenuPosition.compact
                    ? Math.min(agentMenuPosition.width, window.innerWidth - 32)
                    : Math.max(agentMenuPosition.width, Math.min(window.innerWidth - 32, 320)),
                  transform: agentMenuPosition.compact ? 'none' : 'translateX(-50%)',
                  maxHeight: agentMenuPosition.maxHeight,
                }}
              >
                <div className="max-h-[inherit] overflow-y-auto">
                  {agentOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-[13px] text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                      onClick={() => {
                        setAgentMenuOpen(false);
                        if (option.id !== currentAgentId) {
                          onAgentChange(option.id);
                        }
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{option.label}</div>
                      </div>
                      {currentAgentId === option.id ? (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>,
              document.body
            )
          : null}
      </div>
    </div>
  );
}

export default Chat;
