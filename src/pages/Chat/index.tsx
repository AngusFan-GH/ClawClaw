/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput, type ChatModelOption } from './ChatInput';
import { ChatToolbar } from './ChatToolbar';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { PROVIDER_TYPE_INFO, type ProviderAccount, type ProviderVendorInfo } from '@/lib/providers';
import { useNavigate } from 'react-router-dom';

function getRuntimeProviderKey(account: ProviderAccount): string {
  if (account.vendorId === 'google' && account.authMode === 'oauth_browser') {
    return 'google-gemini-cli';
  }
  if (
    account.vendorId === 'openai'
    && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device')
  ) {
    return 'openai-codex';
  }
  if (account.vendorId === 'custom' || account.vendorId === 'ollama' || account.vendorId === 'local-model') {
    const suffix = account.id.replace(/-/g, '').slice(0, 8);
    return `${account.vendorId}-${suffix}`;
  }
  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  return account.vendorId;
}

function resolveAccountModelLabel(
  account: ProviderAccount,
  vendor?: ProviderVendorInfo,
): { modelRef?: string; modelName?: string } {
  const runtimeProviderKey = getRuntimeProviderKey(account);
  const fallbackVendor = PROVIDER_TYPE_INFO.find((item) => item.id === account.vendorId);
  const rawModel = account.model || vendor?.defaultModelId || fallbackVendor?.defaultModelId;

  if (!rawModel) {
    return {
      modelName: vendor?.model || fallbackVendor?.model || account.label,
    };
  }

  return {
    modelRef: rawModel.startsWith(`${runtimeProviderKey}/`) ? rawModel : `${runtimeProviderKey}/${rawModel}`,
    modelName: rawModel.split('/').pop() || rawModel,
  };
}

function normalizeSessionModelValue(
  currentModel: string | undefined,
  options: ChatModelOption[],
): string | undefined {
  if (!currentModel) return undefined;

  const exact = options.find((option) => option.value === currentModel);
  if (exact) return exact.value;

  const normalizedCurrent = currentModel.split('/').pop() || currentModel;
  const bySuffix = options.find((option) => {
    const optionSuffix = option.value.split('/').pop() || option.value;
    return optionSuffix === normalizedCurrent;
  });

  return bySuffix?.value;
}

function dedupeModelOptions(options: ChatModelOption[]): ChatModelOption[] {
  const seenValues = new Set<string>();
  const seenLabels = new Set<string>();

  return options.filter((option) => {
    const valueKey = option.value.trim().toLowerCase();
    const labelKey = option.label.trim().toLowerCase();
    if (seenValues.has(valueKey) || seenLabels.has(labelKey)) {
      return false;
    }
    seenValues.add(valueKey);
    seenLabels.add(labelKey);
    return true;
  });
}

export function Chat() {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const setSessionModel = useChatStore((s) => s.setSessionModel);

  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerVendors = useProviderStore((s) => s.vendors);
  const defaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const providerLoading = useProviderStore((s) => s.loading);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const currentSession = sessions.find((session) => session.key === currentSessionKey);

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages → spinner → messages flicker.
  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    const hasExistingMessages = useChatStore.getState().messages.length > 0;
    (async () => {
      await loadSessions();
      if (cancelled) return;
      await loadHistory(hasExistingMessages);
    })();
    return () => {
      cancelled = true;
      // If the user navigates away without sending any messages, remove the
      // empty session so it doesn't linger as a ghost entry in the sidebar.
      cleanupEmptySession();
    };
  }, [isGatewayRunning, loadHistory, loadSessions, cleanupEmptySession]);

  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  // Auto-scroll on new messages, streaming, or activity changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage, sending, pendingFinal]);

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

  const streamMsg = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as unknown as { role?: string; content?: unknown; timestamp?: number }
    : null;
  const streamText = streamMsg ? extractText(streamMsg) : (typeof streamingMessage === 'string' ? streamingMessage : '');
  const hasStreamText = streamText.trim().length > 0;
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = showThinking && !!streamThinking && streamThinking.trim().length > 0;
  const streamTools = streamMsg ? extractToolUse(streamMsg) : [];
  const hasStreamTools = streamTools.length > 0;
  const streamImages = streamMsg ? extractImages(streamMsg) : [];
  const hasStreamImages = streamImages.length > 0;
  const hasStreamToolStatus = streamingTools.length > 0;
  const shouldRenderStreaming = sending && (hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus);
  const hasAnyStreamContent = hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus;

  const isEmpty = messages.length === 0 && !loading && !sending;
  const providerStatusMap = useMemo(
    () => new Map(providerStatuses.map((status) => [status.id, status])),
    [providerStatuses],
  );
  const vendorMap = useMemo(
    () => new Map(providerVendors.map((vendor) => [vendor.id, vendor])),
    [providerVendors],
  );
  const modelOptions = useMemo<ChatModelOption[]>(() => {
    const baseOptions = providerAccounts
      .filter((account) => account.enabled)
      .filter((account) => (
        account.authMode === 'local'
        || account.authMode === 'oauth_device'
        || account.authMode === 'oauth_browser'
        || Boolean(providerStatusMap.get(account.id)?.hasKey)
      ))
      .map((account) => {
        const vendor = vendorMap.get(account.vendorId);
        const { modelRef, modelName } = resolveAccountModelLabel(account, vendor);
        if (!modelRef) return null;

        return {
          value: modelRef,
          label: `${account.label} · ${modelName || modelRef}`,
          shortLabel: modelName || modelRef,
        };
      })
      .filter((option): option is ChatModelOption => Boolean(option))
      .sort((left, right) => left.label.localeCompare(right.label));

    return dedupeModelOptions(baseOptions);
  }, [providerAccounts, providerStatusMap, vendorMap]);
  const normalizedSelectedModel = useMemo(
    () => normalizeSessionModelValue(currentSession?.model, modelOptions),
    [currentSession?.model, modelOptions],
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
    const { modelName, modelRef } = resolveAccountModelLabel(defaultAccount, vendor);
    return {
      label: `${defaultAccount.label} · ${modelName || modelRef || defaultAccount.label}`,
      shortLabel: modelName || modelRef || defaultAccount.label,
      value: modelRef,
    };
  }, [defaultAccountId, modelOptions, providerAccounts, vendorMap]);
  const normalizedDefaultModelValue = useMemo(
    () => normalizeSessionModelValue(defaultModelMeta.value, modelOptions),
    [defaultModelMeta.value, modelOptions],
  );

  useEffect(() => {
    if (!isGatewayRunning || providerLoading || !currentSession?.model || normalizedSelectedModel) {
      return;
    }

    void setSessionModel(undefined).catch((err) => {
      console.warn('Failed to clear stale session model override:', err);
    });
  }, [
    currentSession?.model,
    isGatewayRunning,
    normalizedSelectedModel,
    providerLoading,
    setSessionModel,
  ]);

  return (
    <div className={cn("flex flex-col -m-6 transition-colors duration-500 dark:bg-background")} style={{ height: 'calc(100vh - 2.5rem)' }}>
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-end px-4 py-2">
        <ChatToolbar />
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {loading && !sending ? (
            <div className="flex h-[60vh] items-center justify-center">
              <LoadingSpinner size="lg" />
            </div>
          ) : isEmpty ? (
            <WelcomeScreen />
          ) : (
            <>
              {messages.map((msg, idx) => (
                <ChatMessage
                  key={msg.id || `msg-${idx}`}
                  message={msg}
                  showThinking={showThinking}
                />
              ))}

              {/* Streaming message */}
              {shouldRenderStreaming && (
                <ChatMessage
                  message={(streamMsg
                    ? {
                        ...(streamMsg as Record<string, unknown>),
                        role: (typeof streamMsg.role === 'string' ? streamMsg.role : 'assistant') as RawMessage['role'],
                        content: streamMsg.content ?? streamText,
                        timestamp: streamMsg.timestamp ?? streamingTimestamp,
                      }
                    : {
                        role: 'assistant',
                        content: streamText,
                        timestamp: streamingTimestamp,
                      }) as RawMessage}
                  showThinking={showThinking}
                  isStreaming
                  streamingTools={streamingTools}
                />
              )}

              {/* Activity indicator: waiting for next AI turn after tool execution */}
              {sending && pendingFinal && !shouldRenderStreaming && (
                <ActivityIndicator phase="tool_processing" />
              )}

              {/* Typing indicator when sending but no stream content yet */}
              {sending && !pendingFinal && !hasAnyStreamContent && (
                <TypingIndicator />
              )}
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
        onSend={sendMessage}
        onStop={abortRun}
        onConfigureModels={() => navigate('/models')}
        disabled={!isGatewayRunning}
        sending={sending}
        isEmpty={isEmpty}
        modelOptions={modelOptions}
        defaultModelShortLabel={defaultModelMeta.shortLabel}
        defaultModelValue={normalizedDefaultModelValue}
        selectedModel={normalizedSelectedModel}
        onModelChange={setSessionModel}
        modelDisabled={!isGatewayRunning}
      />
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

function WelcomeScreen() {
  const { t } = useTranslation('chat');
  const welcomeActions = [
    t('welcome.askQuestions'),
    t('welcome.creativeTasks'),
    t('welcome.brainstorming'),
  ];

  return (
    <div className="flex flex-col items-center justify-center text-center h-[60vh]">
      <h1 className="text-6xl md:text-7xl font-serif text-foreground mb-3 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
        {t('welcome.title')}
      </h1>
      <p className="text-[17px] text-foreground/80 mb-8 font-medium">
        {t('welcome.subtitle')}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2.5 max-w-lg w-full">
        {welcomeActions.map((label, i) => (
          <button 
            key={i} 
            className="px-4 py-1.5 rounded-full border border-black/10 dark:border-white/10 text-[13px] font-medium text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5 transition-colors bg-black/[0.02]"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-muted rounded-2xl px-4 py-3">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

// ── Activity Indicator (shown between tool cycles) ─────────────

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  void phase;
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-muted rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Processing tool results…</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
