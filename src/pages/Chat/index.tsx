/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowDown, Brain, Check, ChevronDown, Loader2 } from 'lucide-react';
import { DEFAULT_SESSION_KEY, useChatStore, type QueuedChatMessage, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { getAppliedAgentsSnapshotState, useAgentsStore } from '@/stores/agents';
import { useSettingsStore } from '@/stores/settings';
import { useRuntimeApplyStore } from '@/stores/runtime-apply';
import type { ProviderAccount } from '@/lib/providers';
import { normalizeChatTimestampMs } from '@/lib/chat-timestamps';
import { PageLoader } from '@/components/common/LoadingSpinner';
import { ChatThread } from './ChatThread';
import { ChatInput, type ChatAgentOption } from './ChatInput';
import { ChatToolbar, type ChatToolbarModelOption } from './ChatToolbar';
import { parseSlashCommand } from './slash-commands';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useLocation, useNavigate } from 'react-router-dom';
import { hostApiFetch } from '@/lib/host-api';
import { buildChatRuntimeModelOptions, type ChatModelCatalogEntry } from './chat-model-catalog';
import {
  dedupeModelOptions,
  getProviderDisplayName,
  resolveAccountModelOptions,
} from './chat-model-options';
import { extractText } from './message-utils';
import {
  buildAgentOptions,
  buildChatRuntimeViewModel,
  normalizeAgentModelValue,
  resolveFallbackModelValue,
  normalizeSelectedModelValue,
  resolveChatModelState,
  resolveCurrentAgentLabel,
  resolveEffectiveAgentModelRef,
} from './chat-page-view-model';
import {
  type ChatThinkingConfigSnapshot,
  listThinkingLevelsForModel,
  normalizeThinkingLevel,
  parseModelRef,
  resolveDefaultThinkingLevel,
} from './thinking-levels';

const CHAT_SEND_RPC_TIMEOUT_MS = 135_000;
const CHAT_SEND_HTTP_TIMEOUT_MS = CHAT_SEND_RPC_TIMEOUT_MS + 5_000;

function getAgentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  const key = sessionKey?.trim();
  if (!key || !key.startsWith('agent:')) return undefined;
  const parts = key.split(':');
  return parts[1]?.trim() || undefined;
}

function buildChatMarkdown(messages: RawMessage[], assistantName: string): string | null {
  if (messages.length === 0) return null;
  const lines: string[] = [`# Chat with ${assistantName}`, ''];
  for (const message of messages) {
    const role =
      message.role === 'user'
        ? 'You'
        : message.role === 'assistant'
          ? assistantName
          : message.role === 'system'
            ? 'System'
            : 'Tool';
    const timestampMs = normalizeChatTimestampMs(message.timestamp);
    const timestamp = timestampMs ? ` (${new Date(timestampMs).toISOString()})` : '';
    lines.push(`## ${role}${timestamp}`, '', extractText(message), '');
  }
  return lines.join('\n');
}

function exportChatMarkdown(messages: RawMessage[], assistantName: string): boolean {
  const markdown = buildChatMarkdown(messages, assistantName);
  if (!markdown) return false;
  const safeName = assistantName.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'assistant';
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `chat-${safeName}-${Date.now()}.md`;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

export function Chat() {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const location = useLocation();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const gatewayInitialized = useGatewayStore((s) => s.isInitialized);
  const displayGatewayState = gatewayInitialized ? gatewayStatus.state : 'starting';
  const isGatewayRunning = displayGatewayState === 'running';

  const messages = useChatStore((s) => s.messages);
  const pendingUserMessage = useChatStore((s) => s.pendingUserMessage);
  const pendingAssistantMessage = useChatStore((s) => s.pendingAssistantMessage);
  const btwMessages = useChatStore((s) => s.btwMessages);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const activeRunId = useChatStore((s) => s.activeRunId);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const sessions = useChatStore((s) => s.sessions);
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
  const terminalHistoryReconciling = useChatStore((s) => s.terminalHistoryReconciling);
  const queueFlushToken = useChatStore((s) => s.queueFlushToken);
  const queuedMessages = useChatStore((s) => s.chatQueue);
  const compactionStatus = useChatStore((s) => s.compactionStatus);
  const fallbackStatus = useChatStore((s) => s.fallbackStatus);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const loadEarlierHistory = useChatStore((s) => s.loadEarlierHistory);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const enqueueChatMessage = useChatStore((s) => s.enqueueChatMessage);
  const removeQueuedMessage = useChatStore((s) => s.removeQueuedMessage);
  const clearChatQueue = useChatStore((s) => s.clearChatQueue);
  const setSessionModel = useChatStore((s) => s.setSessionModel);
  const setModelGuard = useChatStore((s) => s.setModelGuard);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const chatFocusMode = useSettingsStore((s) => s.chatFocusMode);
  const setChatFocusMode = useSettingsStore((s) => s.setChatFocusMode);

  const agents = useAgentsStore((s) => s.agents);
  const defaultAgentId = useAgentsStore((s) => s.defaultAgentId);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerVendors = useProviderStore((s) => s.vendors);
  const runtimeApplyPlan = useRuntimeApplyStore((state) => state.plan);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const [chatRuntimeModelRefs, setChatRuntimeModelRefs] = useState<string[]>([]);
  const [chatModelCatalog, setChatModelCatalog] = useState<ChatModelCatalogEntry[]>([]);
  const [chatThinkingConfig, setChatThinkingConfig] = useState<ChatThinkingConfigSnapshot | null>(null);
  const [chatModelsLoading, setChatModelsLoading] = useState(false);
  const [chatModelsRetryNonce, setChatModelsRetryNonce] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewMessages, setShowNewMessages] = useState(false);
  const chatRuntimeModelRefsRef = useRef<string[]>([]);
  const appliedProviderAccountsRef = useRef<ProviderAccount[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const bottomScrollFrameRef = useRef<number | null>(null);
  const pendingPrependScrollRef = useRef<{ height: number; top: number } | null>(null);
  const processedQueueFlushTokenRef = useRef(0);
  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const currentSession = sessions.find((session) => session.key === currentSessionKey);
  const sessionAgentId = useMemo(
    () => getAgentIdFromSessionKey(currentSessionKey) || getAgentIdFromSessionKey(currentSession?.key),
    [currentSession?.key, currentSessionKey]
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
  const routeAgentId = useMemo(() => {
    const state = location.state as { agentId?: string } | null;
    return typeof state?.agentId === 'string' && state.agentId.trim() ? state.agentId : undefined;
  }, [location.state]);
  const appliedAgentsSnapshot = useMemo(() => {
    void runtimeApplyPlan.pending;
    return getAppliedAgentsSnapshotState();
  }, [agents, defaultAgentId, runtimeApplyPlan.pending]);
  const appliedAgents = appliedAgentsSnapshot.agents;
  const appliedDefaultAgentId = appliedAgentsSnapshot.defaultAgentId;

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
        const nextAgentId = routeAgentId
          && appliedAgents.some((agent) => agent.gateway.id === routeAgentId)
          ? routeAgentId
          : undefined;
        newSession(nextAgentId);
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
        await loadHistory(useChatStore.getState().messages.length > 0);
        if (!cancelled) {
          void loadSessions({ preserveCurrent: true });
        }
        return;
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
    createNewSessionFromRoute,
    routeAgentId,
    appliedAgents,
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

  const hasPendingProviderChanges = useMemo(
    () => runtimeApplyPlan.pending.some((change) => change.domain === 'providers'),
    [runtimeApplyPlan.pending],
  );
  useEffect(() => {
    if (!hasPendingProviderChanges) {
      appliedProviderAccountsRef.current = providerAccounts;
    }
  }, [hasPendingProviderChanges, providerAccounts]);
  const appliedProviderAccounts = useMemo(
    () => (hasPendingProviderChanges ? appliedProviderAccountsRef.current : providerAccounts),
    [hasPendingProviderChanges, providerAccounts],
  );

  const providerCatalogReloadKey = useMemo(
    () => appliedProviderAccounts
      .map((account) => [account.id, account.vendorId, account.model, account.enabled, account.updatedAt].join(':'))
      .sort()
      .join('|'),
    [appliedProviderAccounts],
  );

  const providerDisplayOverrides = useMemo(() => {
    const candidates = new Map<string, Set<string>>();
    const enabledAccounts = appliedProviderAccounts.filter((account) => account.enabled);
    const runtimeKeyForAccount = (account: ProviderAccount): string | undefined => {
      if (account.vendorId === 'google' && account.authMode === 'oauth_browser') {
        return 'google-gemini-cli';
      }
      if (
        account.vendorId === 'openai'
        && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device')
      ) {
        return 'openai-codex';
      }
      if (account.vendorId === 'minimax-portal-cn') {
        return 'minimax-portal';
      }
      if (account.vendorId === 'custom' || account.vendorId === 'ollama' || account.vendorId === 'vllm' || account.vendorId === 'sglang') {
        const suffix = account.id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'default';
        return `${account.vendorId}-${suffix}`;
      }
      return account.vendorId;
    };

    for (const account of enabledAccounts) {
      const runtimeKey = runtimeKeyForAccount(account);
      const label = account.label?.trim();
      if (!runtimeKey || !label) continue;
      const labels = candidates.get(runtimeKey) ?? new Set<string>();
      labels.add(label);
      candidates.set(runtimeKey, labels);
    }

    const map = new Map<string, string>();
    for (const [runtimeKey, labels] of candidates) {
      if (labels.size === 1) {
        const [label] = [...labels];
        if (label) {
          map.set(runtimeKey, label);
        }
      }
    }
    return map;
  }, [appliedProviderAccounts]);

  useEffect(() => {
    chatRuntimeModelRefsRef.current = chatRuntimeModelRefs;
  }, [chatRuntimeModelRefs]);

  useEffect(() => {
    if (!isGatewayRunning) {
      queueMicrotask(() => setChatModelsLoading(false));
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    queueMicrotask(() => {
      if (!cancelled) {
        setChatModelsLoading(true);
      }
    });
    void hostApiFetch<{ refs?: string[]; models?: string[] }>('/api/runtime-model-refs', {
      method: 'GET',
      timeoutMs: 30_000,
    })
      .then((result) => {
        if (cancelled) return;
        const rawRefs = Array.isArray(result?.refs)
          ? result.refs
          : Array.isArray(result?.models)
            ? result.models
            : [];
        const nextRefs = rawRefs.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        );
        if (nextRefs.length > 0 || chatRuntimeModelRefsRef.current.length === 0) {
          setChatRuntimeModelRefs(nextRefs);
          return;
        }
        retryTimer = setTimeout(() => {
          if (!cancelled && useGatewayStore.getState().status.state === 'running') {
            setChatModelsRetryNonce((value) => value + 1);
          }
        }, 2_000);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('[chat] Failed to load runtime model refs for chat picker:', error);
        retryTimer = setTimeout(() => {
          if (!cancelled && useGatewayStore.getState().status.state === 'running') {
            setChatModelsRetryNonce((value) => value + 1);
          }
        }, 2_000);
      })
      .finally(() => {
        if (!cancelled) {
          setChatModelsLoading(false);
        }
      });

    void useGatewayStore.getState().rpc<{ models?: Array<Record<string, unknown>> }>('models.list', {})
      .then((result) => {
        if (cancelled) return;
        const catalog = Array.isArray(result?.models)
          ? result.models.flatMap((entry): ChatModelCatalogEntry[] => {
              const key = typeof entry.key === 'string' ? entry.key : undefined;
              const id = typeof entry.id === 'string'
                ? entry.id
                : key?.includes('/')
                  ? key.slice(key.indexOf('/') + 1)
                  : key;
              const provider = typeof entry.provider === 'string'
                ? entry.provider
                : key?.includes('/')
                  ? key.slice(0, key.indexOf('/'))
                  : '';
              if (!id || !provider) return [];
              const tags = Array.isArray(entry.tags)
                ? entry.tags.filter((tag): tag is string => typeof tag === 'string')
                : [];
              const category = typeof entry.category === 'string' ? entry.category : '';
              return [{
                id,
                provider,
                name: typeof entry.name === 'string' ? entry.name : id,
                alias: typeof entry.alias === 'string' ? entry.alias : undefined,
                contextWindow: typeof entry.contextWindow === 'number' ? entry.contextWindow : undefined,
                reasoning:
                  entry.reasoning === true
                  || category.toLowerCase() === 'reasoning'
                  || tags.some((tag) => tag.toLowerCase() === 'reasoning'),
                xhigh:
                  entry.xhigh === true
                  || tags.some((tag) => tag.toLowerCase() === 'xhigh' || tag.toLowerCase() === 'reasoning.xhigh'),
                input: ['text'],
              }];
            })
          : [];
        setChatModelCatalog(catalog);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[chat] Failed to load runtime model catalog for thinking picker:', error);
          setChatModelCatalog([]);
        }
      });
    void hostApiFetch<{
      success?: boolean;
      config?: ChatThinkingConfigSnapshot;
    }>('/api/gateway/thinking-config')
      .then((result) => {
        if (cancelled) return;
        setChatThinkingConfig(result?.success === false ? null : result?.config ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setChatThinkingConfig(null);
        }
      });
    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [chatModelsRetryNonce, isGatewayRunning, providerCatalogReloadKey]);

  const pinChatToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior,
    });
  }, []);

  const schedulePinChatToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    pinChatToBottom(behavior);
    if (bottomScrollFrameRef.current != null) {
      cancelAnimationFrame(bottomScrollFrameRef.current);
    }
    bottomScrollFrameRef.current = requestAnimationFrame(() => {
      bottomScrollFrameRef.current = null;
      pinChatToBottom('auto');
    });
  }, [pinChatToBottom]);

  useEffect(() => {
    return () => {
      if (bottomScrollFrameRef.current != null) {
        cancelAnimationFrame(bottomScrollFrameRef.current);
        bottomScrollFrameRef.current = null;
      }
    };
  }, []);

  // Keep a restored or streaming thread pinned only while the user is already at the bottom.
  useLayoutEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') {
      return;
    }

    const content = viewport.firstElementChild;
    if (!content) return;

    const observer = new ResizeObserver(() => {
      if (!loadingEarlierHistory && shouldStickToBottomRef.current) {
        pinChatToBottom('auto');
        setShowNewMessages(false);
      }
    });
    observer.observe(content);

    return () => observer.disconnect();
  }, [loadingEarlierHistory, pinChatToBottom]);

  // Always scroll to bottom when the user sends a message, regardless of scroll position.
  // This uses queueMicrotask (runs after DOM update) to ensure the user's own
  // message is visible immediately after send.
  const prevSendingRef = useRef(sending);
  useEffect(() => {
    const wasSending = prevSendingRef.current;
    prevSendingRef.current = sending;
    if (!sending || wasSending) {
      return;
    }
    queueMicrotask(() => {
      schedulePinChatToBottom('auto');
    });
  }, [schedulePinChatToBottom, sending]);

  // Auto-scroll on new messages, streaming, or activity changes when the user is already near the bottom.
  useEffect(() => {
    if (loadingEarlierHistory || !shouldStickToBottomRef.current) {
      if (!loadingEarlierHistory && !shouldStickToBottomRef.current) {
        setShowNewMessages(true);
      }
      return;
    }
    schedulePinChatToBottom(streamingMessage ? 'auto' : 'smooth');
    setShowNewMessages(false);
  }, [messages, streamingMessage, sending, pendingFinal, loadingEarlierHistory, schedulePinChatToBottom]);

  const scrollToBottom = useCallback(() => {
    shouldStickToBottomRef.current = true;
    setShowNewMessages(false);
    schedulePinChatToBottom('smooth');
  }, [schedulePinChatToBottom]);

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
    if (shouldStickToBottomRef.current) {
      setShowNewMessages(false);
    }

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
    queueMicrotask(() => {
      if (sending && streamingTimestamp === 0) {
        setStreamingTimestamp(Date.now() / 1000);
      } else if (!sending && streamingTimestamp !== 0) {
        setStreamingTimestamp(0);
      }
    });
  }, [sending, streamingTimestamp]);

  const modelOptions = useMemo<ChatToolbarModelOption[]>(() => {
    const configuredOptions = appliedProviderAccounts
      .filter((account) => account.enabled)
      .flatMap((account) => {
        const vendor = providerVendors.find((entry) => entry.id === account.vendorId);
        const providerDisplayName = getProviderDisplayName(account, vendor);
        return resolveAccountModelOptions(account, vendor, providerDisplayName);
      });

    const runtimeOptions = buildChatRuntimeModelOptions(chatRuntimeModelRefs, providerDisplayOverrides);
    return dedupeModelOptions([...configuredOptions, ...runtimeOptions]);
  }, [appliedProviderAccounts, chatRuntimeModelRefs, providerDisplayOverrides, providerVendors]);
  const normalizedSelectedModel = useMemo(
    () => normalizeSelectedModelValue(currentSession, modelOptions),
    [currentSession, modelOptions]
  );
  const effectiveAgentModelRef = useMemo(() => {
    return resolveEffectiveAgentModelRef({
      agents: appliedAgents,
      sessionAgentId,
      currentAgentId,
      defaultAgentId: appliedDefaultAgentId,
    });
  }, [appliedAgents, currentAgentId, appliedDefaultAgentId, sessionAgentId]);
  const normalizedAgentModelValue = useMemo(
    () => normalizeAgentModelValue(effectiveAgentModelRef, modelOptions),
    [effectiveAgentModelRef, modelOptions],
  );
  const normalizedDefaultModelValue = useMemo(
    () => resolveFallbackModelValue({
      normalizedAgentModelValue,
      normalizedSelectedModel,
      modelOptions,
    }),
    [modelOptions, normalizedAgentModelValue, normalizedSelectedModel]
  );
  const defaultModelShortLabel = useMemo(
    () => modelOptions.find((option) => option.value === normalizedDefaultModelValue)?.shortLabel,
    [modelOptions, normalizedDefaultModelValue]
  );
  const thinkingModelIdentity = useMemo(() => {
    const sessionProvider = currentSession?.modelProvider?.trim();
    const sessionModel = currentSession?.model?.trim();
    if (sessionProvider && sessionModel) {
      return { provider: sessionProvider, model: sessionModel };
    }
    return parseModelRef(normalizedSelectedModel || normalizedDefaultModelValue);
  }, [
    currentSession?.model,
    currentSession?.modelProvider,
    normalizedDefaultModelValue,
    normalizedSelectedModel,
  ]);
  const thinkingDefault = useMemo(
    () => resolveDefaultThinkingLevel({
      provider: thinkingModelIdentity.provider,
      model: thinkingModelIdentity.model,
      catalog: chatModelCatalog,
      config: chatThinkingConfig,
    }),
    [chatModelCatalog, chatThinkingConfig, thinkingModelIdentity.model, thinkingModelIdentity.provider],
  );

  // Gateway not running block has been completely removed so the UI always renders.
  const effectiveThinkingLevel = (
    currentSession?.thinkingLevel?.trim()
    || thinkingDefault
    || 'off'
  ).toLowerCase();
  const canShowThinkingDetails = effectiveThinkingLevel !== 'off';
  const showThinkingDetails = showThinking && canShowThinkingDetails;

  const {
    liveStreamingMessage,
    shouldShowLoadingState,
    isEmpty,
    currentSessionIsPlaceholder,
    shouldShowWelcome,
  } = useMemo(() => buildChatRuntimeViewModel({
    messages,
    pendingUserMessage,
    pendingAssistantMessage,
    sending,
    showThinking: showThinkingDetails,
    streamingMessage,
    streamingTimestamp,
    currentSessionKey,
    currentSession,
    pendingLocalSessionKeys,
    loading,
    sessionsHydrated,
    isGatewayRunning,
    defaultSessionKey: DEFAULT_SESSION_KEY,
  }), [
    messages,
    pendingUserMessage,
    pendingAssistantMessage,
    sending,
    showThinkingDetails,
    streamingMessage,
    streamingTimestamp,
    currentSessionKey,
    currentSession,
    pendingLocalSessionKeys,
    loading,
    sessionsHydrated,
    isGatewayRunning,
  ]);
  const agentOptions = useMemo<ChatAgentOption[]>(() => {
    return buildAgentOptions(appliedAgents);
  }, [appliedAgents]);
  const canSwitchAgent = currentSessionIsPlaceholder;
  const currentAgentLabel = useMemo(
    () => resolveCurrentAgentLabel({
      agentOptions,
      agents: appliedAgents,
      currentAgentId,
      sessionAgentId,
      defaultAgentId: appliedDefaultAgentId,
    }),
    [agentOptions, appliedAgents, currentAgentId, sessionAgentId, appliedDefaultAgentId]
  );

  const resolvedAgentLabel = currentAgentLabel?.trim() || 'Main';
  const resolvedAssistantName = resolvedAgentLabel;
  const handleExportChat = useCallback(() => {
    exportChatMarkdown(messages, resolvedAssistantName);
  }, [messages, resolvedAssistantName]);

  useEffect(() => {
    const allowed = modelOptions.map((option) => option.value);
    setModelGuard(allowed, normalizedDefaultModelValue);
  }, [modelOptions, normalizedDefaultModelValue, setModelGuard]);

  const modelState = resolveChatModelState({
    isGatewayRunning,
    currentSessionModel: normalizedSelectedModel || currentSession?.model,
    normalizedSelectedModel,
    defaultModelValue: normalizedDefaultModelValue,
    modelOptions,
    modelCatalogSyncing: chatModelsLoading,
  });
  const thinkingOptions = useMemo(
    () => [
      '',
      ...listThinkingLevelsForModel({
        provider: thinkingModelIdentity.provider,
        model: thinkingModelIdentity.model,
        catalog: chatModelCatalog,
        currentLevel: currentSession?.thinkingLevel,
      }),
    ],
    [chatModelCatalog, currentSession?.thinkingLevel, thinkingModelIdentity.model, thinkingModelIdentity.provider]
  );
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

  useEffect(() => {
    queueMicrotask(() => clearChatQueue());
  }, [clearChatQueue, currentSessionKey]);

  const appendSystemMessage = useCallback((content: string): void => {
    const message: RawMessage = {
      role: 'system',
      content,
      timestamp: Date.now(),
      id: `local-command-${crypto.randomUUID()}`,
    };
    useChatStore.setState((state) => ({ messages: [...state.messages, message] }));
  }, []);

  const resetCurrentChatHistory = useCallback(async (): Promise<void> => {
    await useGatewayStore.getState().rpc('sessions.reset', { key: currentSessionKey });
    useChatStore.setState((state) => ({
      messages: [],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      btwMessages: [],
      pendingFinal: false,
      terminalHistoryReconciling: false,
      sending: false,
      activeRunId: null,
      error: null,
      chatToolMessages: [],
      chatStreamSegments: [],
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      toolStreamById: new Map(),
      toolStreamOrder: [],
      pendingLocalSessionKeys: {
        ...state.pendingLocalSessionKeys,
        [currentSessionKey]: true,
      },
    }));
    await loadHistory(false);
  }, [currentSessionKey, loadHistory]);

  const setSessionThinkingLevel = useCallback(async (level?: string): Promise<void> => {
    const normalizedLevel = (normalizeThinkingLevel(level) ?? level?.trim()) || undefined;
    const previousState = useChatStore.getState();
    const previousStoreLevel = previousState.thinkingLevel;
    const previousSessionLevel = previousState.sessions.find(
      (session) => session.key === currentSessionKey
    )?.thinkingLevel;

    useChatStore.setState((state) => ({
      thinkingLevel: normalizedLevel ?? null,
      sessions: state.sessions.map((session) => (
        session.key === currentSessionKey
          ? { ...session, thinkingLevel: normalizedLevel }
          : session
      )),
      error: null,
    }));

    const isEmptyLocalSession =
      !currentSessionKey.endsWith(':main') &&
      Boolean(previousState.pendingLocalSessionKeys[currentSessionKey]) &&
      previousState.messages.length === 0 &&
      !previousState.pendingUserMessage &&
      !previousState.pendingAssistantMessage;
    if (isEmptyLocalSession) {
      return;
    }

    try {
      await useGatewayStore.getState().rpc('sessions.patch', {
        key: currentSessionKey,
        thinkingLevel: normalizedLevel ?? null,
      });
      void loadSessions({ preserveCurrent: true, warmLabels: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useChatStore.setState((state) => ({
        thinkingLevel: state.currentSessionKey === currentSessionKey
          ? previousStoreLevel
          : state.thinkingLevel,
        sessions: state.sessions.map((session) => (
          session.key === currentSessionKey
            ? { ...session, thinkingLevel: previousSessionLevel }
            : session
        )),
        error: message,
      }));
      throw err;
    }
  }, [currentSessionKey, loadSessions]);

  const executeLocalSlashCommand = useCallback(async (
    commandName: string,
    args: string,
  ): Promise<boolean> => {
    const trimmedArgs = args.trim();

    switch (commandName) {
      case 'new': {
        newSession(currentAgentId);
        return true;
      }
      case 'reset':
      case 'clear': {
        await resetCurrentChatHistory();
        return true;
      }
      case 'model': {
        if (!trimmedArgs) {
          const label = normalizedSelectedModel || normalizedAgentModelValue || normalizedDefaultModelValue || 'default';
          appendSystemMessage(`Current model: \`${label}\`.`);
          return true;
        }
        await setSessionModel(trimmedArgs);
        appendSystemMessage(`Model set to \`${trimmedArgs}\`.`);
        void loadSessions({ preserveCurrent: true, warmLabels: true });
        return true;
      }
      case 'think':
      case 'thinking': {
        if (!trimmedArgs) {
          appendSystemMessage(`Current thinking level: ${currentSession?.thinkingLevel || 'default'}.`);
          return true;
        }
        await setSessionThinkingLevel(trimmedArgs);
        appendSystemMessage(`Thinking level set to **${trimmedArgs}**.`);
        return true;
      }
      case 'compact': {
        const result = await useGatewayStore.getState().rpc<{
          compacted?: boolean;
          reason?: string;
          result?: { tokensBefore?: number; tokensAfter?: number };
        }>('sessions.compact', { key: currentSessionKey });
        if (result?.compacted) {
          const before = result.result?.tokensBefore;
          const after = result.result?.tokensAfter;
          const tokenSummary =
            typeof before === 'number' && typeof after === 'number'
              ? ` (${before.toLocaleString()} -> ${after.toLocaleString()} tokens)`
              : '';
          appendSystemMessage(`Context compacted successfully${tokenSummary}.`);
        } else if (typeof result?.reason === 'string' && result.reason.trim()) {
          appendSystemMessage(`Compaction skipped: ${result.reason}`);
        } else {
          appendSystemMessage('Compaction skipped.');
        }
        await loadHistory(true);
        return true;
      }
      case 'focus': {
        setChatFocusMode(true);
        appendSystemMessage('Focus mode enabled.');
        return true;
      }
      case 'unfocus': {
        setChatFocusMode(false);
        appendSystemMessage('Focus mode disabled.');
        return true;
      }
      case 'export-session': {
        exportChatMarkdown(messages, resolvedAssistantName);
        return true;
      }
      case 'steer': {
        if (!trimmedArgs) {
          appendSystemMessage('Usage: `/steer <message>`');
          return true;
        }
        if (!sending && !activeRunId) {
          appendSystemMessage('No active run. Use the chat input or `/redirect` instead.');
          return true;
        }
        await useGatewayStore.getState().rpc('chat.send', {
          sessionKey: currentSessionKey,
          message: trimmedArgs,
          deliver: false,
          idempotencyKey: crypto.randomUUID(),
        }, CHAT_SEND_RPC_TIMEOUT_MS);
        if (activeRunId) {
          enqueueChatMessage({
            text: `/steer ${trimmedArgs}`,
            pendingRunId: activeRunId,
          });
        }
        return true;
      }
      case 'redirect': {
        if (!trimmedArgs) {
          appendSystemMessage('Usage: `/redirect <message>`');
          return true;
        }
        const result = await useGatewayStore.getState().rpc<{ runId?: string }>('sessions.steer', {
          key: currentSessionKey,
          message: trimmedArgs,
        });
        const runId = typeof result?.runId === 'string' ? result.runId : null;
        useChatStore.setState({
          sending: Boolean(runId),
          activeRunId: runId,
          pendingFinal: false,
          terminalHistoryReconciling: false,
          error: null,
        });
        appendSystemMessage('Redirected.');
        return true;
      }
      default:
        return false;
    }
  }, [
    activeRunId,
    appendSystemMessage,
    currentAgentId,
    currentSession?.thinkingLevel,
    currentSessionKey,
    loadHistory,
    loadSessions,
    messages,
    newSession,
    enqueueChatMessage,
    normalizedAgentModelValue,
    normalizedDefaultModelValue,
    normalizedSelectedModel,
    resetCurrentChatHistory,
    resolvedAssistantName,
    sending,
    setChatFocusMode,
    setSessionThinkingLevel,
    setSessionModel,
  ]);

  const handleDetachedBtwSend = useCallback(async (
    text: string,
    attachments?: QueuedChatMessage['attachments'],
  ): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || !isGatewayRunning) {
      return;
    }
    try {
      if (attachments && attachments.length > 0) {
        await hostApiFetch('/api/chat/send-with-media', {
          method: 'POST',
          timeoutMs: CHAT_SEND_HTTP_TIMEOUT_MS,
          body: JSON.stringify({
            sessionKey: currentSessionKey,
            message: trimmed,
            deliver: false,
            idempotencyKey: crypto.randomUUID(),
            media: attachments.map((file) => ({
              filePath: file.stagedPath,
              mimeType: file.mimeType,
              fileName: file.fileName,
            })),
          }),
        });
      } else {
        await useGatewayStore.getState().rpc('chat.send', {
          sessionKey: currentSessionKey,
          message: trimmed,
          deliver: false,
          idempotencyKey: crypto.randomUUID(),
        }, CHAT_SEND_RPC_TIMEOUT_MS);
      }
    } catch (err) {
      useChatStore.setState({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [currentSessionKey, isGatewayRunning]);

  const handleChatSend = useCallback(async (text: string, attachments?: QueuedChatMessage['attachments']): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) {
      return;
    }
    const parsed = parseSlashCommand(trimmed);
    const commandName = parsed?.command.name;

    if (commandName === 'stop') {
      await abortRun();
      return;
    }
    if (commandName === 'btw') {
      await handleDetachedBtwSend(trimmed, attachments);
      return;
    }
    if (
      commandName
      && (sending || activeRunId)
      && !['focus', 'unfocus', 'export-session', 'steer', 'redirect'].includes(commandName)
    ) {
      enqueueChatMessage({
        text: trimmed,
        attachments,
      });
      return;
    }
    if (commandName) {
      try {
        const handled = await executeLocalSlashCommand(commandName, parsed?.args ?? '');
        if (handled) {
          const state = useChatStore.getState();
          if (!state.sending && !state.activeRunId && !state.pendingFinal && !state.terminalHistoryReconciling) {
            state.requestQueueFlush(null);
          }
          return;
        }
      } catch (err) {
        useChatStore.setState({ error: err instanceof Error ? err.message : String(err) });
        return;
      }
    }

    if (sending || activeRunId) {
      enqueueChatMessage({
        text: trimmed,
        attachments,
      });
      return;
    }

    await sendMessage(trimmed, attachments);
  }, [
    abortRun,
    activeRunId,
    enqueueChatMessage,
    executeLocalSlashCommand,
    handleDetachedBtwSend,
    sendMessage,
    sending,
  ]);

  useEffect(() => {
    if (queueFlushToken <= processedQueueFlushTokenRef.current) {
      return;
    }
    if (sending || activeRunId || pendingFinal || terminalHistoryReconciling || queuedMessages.length === 0) {
      return;
    }

    const nextIndex = queuedMessages.findIndex((item) => !item.pendingRunId);
    if (nextIndex < 0) {
      processedQueueFlushTokenRef.current = queueFlushToken;
      return;
    }
    const next = queuedMessages[nextIndex];
    processedQueueFlushTokenRef.current = queueFlushToken;
    queueMicrotask(() => {
      removeQueuedMessage(next.id);
      void handleChatSend(next.text, next.attachments);
    });
  }, [
    activeRunId,
    handleChatSend,
    pendingFinal,
    queueFlushToken,
    queuedMessages,
    removeQueuedMessage,
    sending,
    terminalHistoryReconciling,
  ]);

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-1 flex-col -m-6 overflow-hidden transition-colors duration-500 dark:bg-background'
      )}
    >
      {chatFocusMode ? (
        <button
          type="button"
          className="absolute right-4 top-4 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-card/90 text-lg leading-none text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground dark:border-white/10"
          onClick={() => setChatFocusMode(false)}
          aria-label={t('toolbar.exitFocusMode', 'Exit focus mode')}
          title={t('toolbar.exitFocusMode', 'Exit focus mode')}
        >
          ×
        </button>
      ) : null}

      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2">
        <ChatToolbar
          currentAgentLabel={resolvedAgentLabel}
          showAgentLabel={!shouldShowWelcome && !canSwitchAgent}
          searchQuery={shouldShowWelcome ? undefined : searchQuery}
          onSearchChange={shouldShowWelcome ? undefined : setSearchQuery}
          canExport={messages.length > 0}
          onExport={handleExportChat}
        />
      </div>

      {/* Messages Area */}
      <div
        ref={scrollViewportRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        onScroll={handleMessagesScroll}
      >
        <div className="max-w-4xl mx-auto space-y-4">
          {shouldShowLoadingState ? (
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
                    compactionStatus.phase === 'complete'
                      ? 'compaction-indicator--complete'
                      : compactionStatus.phase === 'retrying'
                        ? 'compaction-indicator--retrying'
                        : 'compaction-indicator--active'
                  )}
                >
                  {compactionStatus.phase === 'complete' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  <span>
                    {compactionStatus.phase === 'complete'
                      ? t('status.contextCompacted', 'Context compacted')
                      : compactionStatus.phase === 'retrying'
                        ? t('status.compactionRetrying', 'Context compacted; retrying run')
                        : t('status.compactingContext', 'Compacting context')}
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
                pendingUserMessage={pendingUserMessage}
                pendingAssistantMessage={pendingAssistantMessage}
                btwMessages={btwMessages}
                toolMessages={chatToolMessages}
                streamSegments={chatStreamSegments}
                streamingMessage={liveStreamingMessage}
                streamingStartedAt={streamingTimestamp}
                sending={sending}
                pendingFinal={pendingFinal}
                showThinking={showThinkingDetails}
                sessionKey={currentSessionKey}
                contextWindow={currentSession?.contextTokens ?? null}
                assistantName={resolvedAssistantName}
                historyWindowLimited={historyWindowLimited}
                canLoadEarlier={hasEarlierHistory}
                loadingEarlierHistory={loadingEarlierHistory}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                hideSearch
              />
              {showNewMessages ? (
                <button
                  type="button"
                  className={cn(
                    'fixed left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-black/10 bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur hover:bg-card dark:border-white/10',
                    queuedMessages.length > 0 ? 'bottom-48' : 'bottom-28'
                  )}
                  onClick={scrollToBottom}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  {t('status.newMessages', 'New messages')}
                </button>
              ) : null}

            </>
          )}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {queuedMessages.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-4 bottom-28 z-20 flex justify-center">
          <div className="pointer-events-auto w-full max-w-4xl rounded-[18px] border border-black/10 bg-card/95 p-3 shadow-[0_18px_50px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:border-white/10">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span>{t('status.queuedMessages', '已排队')} ({queuedMessages.length})</span>
            </div>
            <div className="max-h-28 space-y-2 overflow-y-auto pr-1">
              {queuedMessages.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-[12px] bg-black/5 px-3 py-2 text-sm dark:bg-white/5"
                >
                  <div className="min-w-0 flex-1 truncate">
                    {item.text || t('status.queuedAttachmentOnly', '仅附件消息')}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeQueuedMessage(item.id)}
                    className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    {t('common:actions.remove', '移除')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Error bar */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
          <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <p className="flex min-w-0 items-start gap-2 text-sm leading-6 text-destructive">
              <AlertCircle className="mt-1 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </p>
            <button
              onClick={clearError}
              className="shrink-0 self-start whitespace-nowrap text-xs text-destructive/60 underline hover:text-destructive sm:mt-1"
            >
              {t('common:actions.dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <ChatInput
        onSend={handleChatSend}
        onStop={abortRun}
        onToggleThinking={canShowThinkingDetails ? toggleThinking : undefined}
        resetKey={`${currentSessionKey || 'no-session'}:${shouldShowWelcome ? 'welcome' : isEmpty ? 'empty' : 'active'}`}
        modelOptions={modelOptions}
        selectedModel={normalizedSelectedModel || normalizedAgentModelValue}
        defaultModelValue={normalizedDefaultModelValue}
        defaultModelShortLabel={defaultModelShortLabel}
        onModelChange={setSessionModel}
        onConfigureModels={() => navigate('/models')}
        modelDisabled={!isGatewayRunning}
        modelState={modelState}
        thinkingLevel={currentSession?.thinkingLevel ?? null}
        thinkingOptions={thinkingOptions}
        thinkingDefault={thinkingDefault}
        onThinkingLevelChange={setSessionThinkingLevel}
        thinkingDisabled={!isGatewayRunning || sending || Boolean(activeRunId) || loading}
        disabled={!isGatewayRunning}
        sending={sending}
        isEmpty={shouldShowWelcome}
        showThinking={showThinkingDetails}
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
            'group flex w-full items-center gap-3 rounded-[16px] border border-black/10 bg-gradient-to-b from-white/95 to-white/70 px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-px hover:border-black/15 hover:bg-white hover:shadow-[0_8px_22px_rgba(15,23,42,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 dark:border-white/10 dark:from-white/[0.09] dark:to-white/[0.04] dark:hover:border-white/15 dark:hover:bg-white/[0.10] sm:gap-4 sm:px-5 sm:py-4',
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
          {canSwitchAgent ? <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:scale-110', agentMenuOpen && 'rotate-180')} /> : null}
        </button>
        {agentMenuOpen && canSwitchAgent && agentMenuPosition
          ? createPortal(
              <div
                ref={agentMenuRef}
                className="fixed z-[120] overflow-hidden rounded-[18px] border border-black/10 bg-card/95 p-1.5 text-left shadow-[0_18px_48px_rgba(15,23,42,0.18)] ring-1 ring-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-card/95 dark:ring-white/10"
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
                <div className="max-h-[inherit] overflow-y-auto pr-0.5">
                  {agentOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left text-[13px] transition-colors',
                        currentAgentId === option.id
                          ? 'bg-primary/10 font-semibold text-primary'
                          : 'text-foreground hover:bg-black/5 dark:hover:bg-white/5'
                      )}
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
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-3 w-3" />
                        </span>
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
