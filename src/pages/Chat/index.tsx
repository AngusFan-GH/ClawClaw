/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Brain, Check, ChevronDown, Loader2 } from 'lucide-react';
import { DEFAULT_SESSION_KEY, useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useAgentsStore } from '@/stores/agents';
import type { ProviderAccount } from '@/lib/providers';
import { PageLoader } from '@/components/common/LoadingSpinner';
import { ChatThread } from './ChatThread';
import { ChatInput, type ChatAgentOption, type FileAttachment } from './ChatInput';
import { ChatToolbar, type ChatToolbarModelOption } from './ChatToolbar';
import { parseSlashCommand } from './slash-commands';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useLocation, useNavigate } from 'react-router-dom';
import { hostApiFetch } from '@/lib/host-api';
import { buildChatCatalogModelOptions, type ChatModelCatalogEntry } from './chat-model-catalog';
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

function getAgentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  const key = sessionKey?.trim();
  if (!key || !key.startsWith('agent:')) return undefined;
  const parts = key.split(':');
  return parts[1]?.trim() || undefined;
}

type QueuedChatItem = {
  id: string;
  text: string;
  attachments?: FileAttachment[];
};

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
  const pendingUserMessage = useChatStore((s) => s.pendingUserMessage);
  const pendingAssistantMessage = useChatStore((s) => s.pendingAssistantMessage);
  const btwMessages = useChatStore((s) => s.btwMessages);
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
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const [chatModelCatalog, setChatModelCatalog] = useState<ChatModelCatalogEntry[]>([]);
  const [chatModelsLoading, setChatModelsLoading] = useState(false);
  const [chatModelsRetryNonce, setChatModelsRetryNonce] = useState(0);
  const [queuedMessages, setQueuedMessages] = useState<QueuedChatItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const chatModelCatalogRef = useRef<ChatModelCatalogEntry[]>([]);

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
        newSession(routeAgentId);
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
        await loadHistory(messages.length > 0);
        if (!cancelled) {
          void loadSessions({ preserveCurrent: true });
        }
        return;
      }

      if (!sessionsHydrated) {
        await restoreSessionsAfterGatewayReady();
      } else {
        await loadHistory(messages.length > 0);
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
    messages.length,
    createNewSessionFromRoute,
    routeAgentId,
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

  const providerCatalogReloadKey = useMemo(
    () => providerAccounts
      .map((account) => [account.id, account.vendorId, account.model, account.enabled, account.updatedAt].join(':'))
      .sort()
      .join('|'),
    [providerAccounts],
  );

  const providerDisplayOverrides = useMemo(() => {
    const candidates = new Map<string, Set<string>>();
    const enabledAccounts = providerAccounts.filter((account) => account.enabled);
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
  }, [providerAccounts]);

  useEffect(() => {
    chatModelCatalogRef.current = chatModelCatalog;
  }, [chatModelCatalog]);

  useEffect(() => {
    if (!isGatewayRunning) {
      setChatModelsLoading(false);
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setChatModelsLoading(true);
    void useGatewayStore.getState().rpc<{ models?: ChatModelCatalogEntry[] }>('models.list', {}, 30_000)
      .then((result) => {
        if (cancelled) return;
        const nextModels = Array.isArray(result?.models) ? result.models : [];
        if (nextModels.length > 0 || chatModelCatalogRef.current.length === 0) {
          setChatModelCatalog(nextModels);
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
        console.warn('[chat] Failed to load models.list for chat picker:', error);
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
    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [chatModelsRetryNonce, isGatewayRunning, providerCatalogReloadKey]);

  // Always scroll to bottom when the user sends a message, regardless of scroll position.
  // This uses queueMicrotask (runs after DOM update) to ensure the user's own
  // message is visible immediately after send.
  const prevSendingRef = useRef(false);
  const sendingJustStarted = sending && !prevSendingRef.current;
  prevSendingRef.current = sending;
  if (sendingJustStarted) {
    queueMicrotask(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    });
  }

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
      setStreamingTimestamp(Date.now() / 1000);
    } else if (!sending && streamingTimestamp !== 0) {
      setStreamingTimestamp(0);
    }
  }, [sending, streamingTimestamp]);

  // Gateway not running block has been completely removed so the UI always renders.

  const {
    liveStreamingMessage,
    isRestoringSessions,
    isEmpty,
    currentSessionIsPlaceholder,
    shouldShowWelcome,
  } = useMemo(() => buildChatRuntimeViewModel({
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
    defaultSessionKey: DEFAULT_SESSION_KEY,
  }), [
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
  ]);
  const modelOptions = useMemo<ChatToolbarModelOption[]>(() => {
    return buildChatCatalogModelOptions(chatModelCatalog, providerDisplayOverrides);
  }, [chatModelCatalog, providerDisplayOverrides]);
  const normalizedSelectedModel = useMemo(
    () => normalizeSelectedModelValue(currentSession, modelOptions),
    [currentSession, modelOptions]
  );
  const effectiveAgentModelRef = useMemo(() => {
    return resolveEffectiveAgentModelRef({
      agents,
      sessionAgentId,
      currentAgentId,
      defaultAgentId,
    });
  }, [agents, currentAgentId, defaultAgentId, sessionAgentId]);
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
  const agentOptions = useMemo<ChatAgentOption[]>(() => {
    return buildAgentOptions(agents);
  }, [agents]);
  const canSwitchAgent = currentSessionIsPlaceholder;
  const currentAgentLabel = useMemo(
    () => resolveCurrentAgentLabel({
      agentOptions,
      agents,
      currentAgentId,
      sessionAgentId,
      defaultAgentId,
    }),
    [agentOptions, agents, currentAgentId, sessionAgentId, defaultAgentId]
  );

  const resolvedAgentLabel = currentAgentLabel?.trim() || 'Main';
  const resolvedAssistantName = resolvedAgentLabel;

  useEffect(() => {
    const allowed = modelOptions.map((option) => option.value);
    setModelGuard(allowed, normalizedDefaultModelValue);
  }, [modelOptions, normalizedDefaultModelValue, setModelGuard]);

  const modelState = resolveChatModelState({
    isGatewayRunning,
    currentSessionModel: currentSession?.model,
    normalizedSelectedModel,
    defaultModelValue: normalizedDefaultModelValue,
    modelOptions,
    modelCatalogSyncing: chatModelsLoading,
  });
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
    setQueuedMessages([]);
  }, [currentSessionKey]);

  useEffect(() => {
    if (sending || queuedMessages.length === 0) {
      return;
    }
    const [next, ...rest] = queuedMessages;
    setQueuedMessages(rest);
    void sendMessage(next.text, next.attachments);
  }, [queuedMessages, sendMessage, sending]);

  const handleRemoveQueuedMessage = (id: string): void => {
    setQueuedMessages((items) => items.filter((item) => item.id !== id));
  };

  const handleDetachedBtwSend = async (
    text: string,
    attachments?: FileAttachment[],
  ): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || !isGatewayRunning) {
      return;
    }
    try {
      if (attachments && attachments.length > 0) {
        await hostApiFetch('/api/chat/send-with-media', {
          method: 'POST',
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
        }, 120_000);
      }
    } catch (err) {
      useChatStore.setState({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleChatSend = async (text: string, attachments?: FileAttachment[]): Promise<void> => {
    const trimmed = text.trim();
    const parsed = parseSlashCommand(trimmed);
    const commandName = parsed?.command.name;

    if (sending) {
      if (commandName === 'stop') {
        await abortRun();
        return;
      }
      if (commandName === 'btw') {
        await handleDetachedBtwSend(trimmed, attachments);
        return;
      }
      setQueuedMessages((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          text: trimmed,
          attachments,
        },
      ]);
      return;
    }

    await sendMessage(trimmed, attachments);
  };

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col -m-6 overflow-hidden transition-colors duration-500 dark:bg-background'
      )}
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2">
        <ChatToolbar
          currentAgentLabel={resolvedAgentLabel}
          showAgentLabel={!shouldShowWelcome && !canSwitchAgent}
          searchQuery={shouldShowWelcome ? undefined : searchQuery}
          onSearchChange={shouldShowWelcome ? undefined : setSearchQuery}
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
                pendingUserMessage={pendingUserMessage}
                pendingAssistantMessage={pendingAssistantMessage}
                btwMessages={btwMessages}
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
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                hideSearch
              />
              {queuedMessages.length > 0 ? (
                <div className="rounded-[16px] border border-black/10 bg-card/80 p-3 shadow-sm dark:border-white/10">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {t('status.queuedMessages', '已排队')} ({queuedMessages.length})
                  </div>
                  <div className="space-y-2">
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
                          onClick={() => handleRemoveQueuedMessage(item.id)}
                          className="text-xs text-muted-foreground underline hover:text-foreground"
                        >
                          {t('common:actions.remove', '移除')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

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
        onSend={handleChatSend}
        onStop={abortRun}
        onToggleThinking={toggleThinking}
        resetKey={`${currentSessionKey || 'no-session'}:${shouldShowWelcome ? 'welcome' : isEmpty ? 'empty' : 'active'}`}
        modelOptions={modelOptions}
        selectedModel={normalizedSelectedModel || normalizedAgentModelValue}
        defaultModelValue={normalizedDefaultModelValue}
        defaultModelShortLabel={defaultModelShortLabel}
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
