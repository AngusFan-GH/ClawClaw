/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via gateway:rpc IPC. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Bot, Check, ChevronDown } from 'lucide-react';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useAgentsStore } from '@/stores/agents';
import { LoadingIcon, PageLoader } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput, type ChatAgentOption, type FileAttachment } from './ChatInput';
import { ChatToolbar, type ChatToolbarModelOption } from './ChatToolbar';
import { extractImages, extractText, extractThinking, extractToolUse } from './message-utils';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { PROVIDER_TYPE_INFO, type ProviderAccount, type ProviderVendorInfo } from '@/lib/providers';
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
  if (account.vendorId === 'custom' || account.vendorId === 'ollama' || account.vendorId === 'local-model') {
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
  providerDisplayName: string,
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
  return vendorId === 'custom' || vendorId === 'ollama' || vendorId === 'local-model';
}

function getProviderDisplayName(account: ProviderAccount, vendor?: ProviderVendorInfo): string {
  if (account.metadata?.managedBy === 'preset-local-model') {
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
};

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

export function Chat() {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const location = useLocation();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const showThinking = useChatStore((s) => s.showThinking);
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const switchSession = useChatStore((s) => s.switchSession);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const pendingLocalSessionKeys = useChatStore((s) => s.pendingLocalSessionKeys);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingTools = useChatStore((s) => s.streamingTools);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const setSessionModel = useChatStore((s) => s.setSessionModel);
  const setModelGuard = useChatStore((s) => s.setModelGuard);
  const newSession = useChatStore((s) => s.newSession);
  const toggleThinking = useChatStore((s) => s.toggleThinking);

  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerVendors = useProviderStore((s) => s.vendors);
  const defaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const providerLoading = useProviderStore((s) => s.loading);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const [providerCatalogMap, setProviderCatalogMap] = useState<Record<string, ProviderCatalogResponse>>({});
  const [runtimeModelRefs, setRuntimeModelRefs] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [streamingTimestamp, setStreamingTimestamp] = useState<number>(0);
  const currentSession = sessions.find((session) => session.key === currentSessionKey);
  const providerStatusMap = useMemo(
    () => new Map(providerStatuses.map((status) => [status.id, status])),
    [providerStatuses]
  );
  const vendorMap = useMemo(
    () => new Map(providerVendors.map((vendor) => [vendor.id, vendor])),
    [providerVendors]
  );
  const forceSessionKeyFromRoute = useMemo(() => {
    const state = location.state as { forceSessionKey?: string } | null;
    const candidate = state?.forceSessionKey;
    return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
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
      if (forceSessionKeyFromRoute) {
        if (forceSessionKeyFromRoute !== useChatStore.getState().currentSessionKey) {
          switchSession(forceSessionKeyFromRoute);
        }
        navigate(location.pathname, { replace: true, state: null });
        await loadHistory(false);
        if (!cancelled) {
          void loadSessions(false);
        }
        return;
      }

      await loadSessions(true);
      if (cancelled) return;
      await loadHistory(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isGatewayRunning,
    loadHistory,
    loadSessions,
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
        setRuntimeModelRefs([]);
      });
      return;
    }
    let cancelled = false;
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

  useEffect(() => {
    let cancelled = false;
    const eligibleAccounts = providerAccounts.filter((account) => account.enabled)
      .filter(
        (account) =>
          account.authMode === 'local'
          || account.authMode === 'oauth_device'
          || account.authMode === 'oauth_browser'
          || Boolean(providerStatusMap.get(account.id)?.hasKey),
      );
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
  }, [providerAccounts, providerStatusMap]);

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
  const hasStreamToolStatus = streamingTools.length > 0;
  const shouldRenderStreaming =
    sending &&
    (hasStreamText ||
      hasStreamThinking ||
      hasStreamTools ||
      hasStreamImages ||
      hasStreamToolStatus);
  const hasAnyStreamContent =
    hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus;

  const isEmpty = messages.length === 0 && !loading && !sending;
  const shouldShowWelcome =
    isEmpty && (!currentSession || Boolean(pendingLocalSessionKeys[currentSessionKey]));
  const modelOptions = useMemo<ChatToolbarModelOption[]>(() => {
    const baseOptions = providerAccounts
      .filter((account) => account.enabled)
      .filter(
        (account) =>
          account.authMode === 'local' ||
          account.authMode === 'oauth_device' ||
          account.authMode === 'oauth_browser' ||
          Boolean(providerStatusMap.get(account.id)?.hasKey)
      )
      .flatMap((account) => {
        const vendor = vendorMap.get(account.vendorId);
        const providerDisplayName = getProviderDisplayName(account, vendor);
        const catalog = providerCatalogMap[account.id];
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
        if (catalog?.resolved) {
          return catalogOptions;
        }
        return explicitOptions;
      })
      .sort((left, right) => left.label.localeCompare(right.label));

    const deduped = dedupeModelOptions(baseOptions);
    if (runtimeModelRefs.length === 0) {
      return deduped;
    }
    const runtimeSet = new Set(runtimeModelRefs);
    return deduped.filter((option) => runtimeSet.has(option.value));
  }, [providerAccounts, providerCatalogMap, providerStatusMap, runtimeModelRefs, vendorMap]);
  const normalizedSelectedModel = useMemo(
    () => normalizeSessionModelValue(currentSession, modelOptions),
    [currentSession, modelOptions]
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
      providerDisplayName,
      defaultCatalog?.runtimeProviderId,
    );
    return {
      label: `${providerDisplayName} · ${modelName || modelRef || providerDisplayName}`,
      shortLabel: modelName || modelRef || defaultAccount.label,
      value: modelRef,
    };
  }, [defaultAccountId, modelOptions, providerAccounts, providerCatalogMap, vendorMap]);
  const normalizedDefaultModelValue = useMemo(
    () => normalizeSessionModelValue(
      defaultModelMeta.value ? { model: defaultModelMeta.value } : undefined,
      modelOptions,
    ),
    [defaultModelMeta.value, modelOptions]
  );
  const agentOptions = useMemo<ChatAgentOption[]>(() => {
    const sorted = [...agents].sort((left, right) => {
      if (left.isDefault) return -1;
      if (right.isDefault) return 1;
      return left.name.localeCompare(right.name);
    });
    return sorted.map((agent) => ({
      id: agent.id,
      label: agent.name,
    }));
  }, [agents]);
  const canSwitchAgent = Boolean(pendingLocalSessionKeys[currentSessionKey]);
  const currentAgentLabel = useMemo(
    () =>
      agentOptions.find((option) => option.id === currentAgentId)?.label ||
      agents.find((agent) => agent.id === currentAgentId)?.name ||
      currentAgentId,
    [agentOptions, agents, currentAgentId]
  );

  useEffect(() => {
    const allowed = modelOptions.map((option) => option.value);
    setModelGuard(allowed, normalizedDefaultModelValue);
  }, [modelOptions, normalizedDefaultModelValue, setModelGuard]);

  useEffect(() => {
    if (
      !isGatewayRunning
      || providerLoading
      || modelOptions.length === 0
      || !currentSession?.model
      || normalizedSelectedModel
    ) {
      return;
    }

    void setSessionModel(undefined).catch((err) => {
      console.warn('Failed to clear stale session model override:', err);
    });
  }, [
    currentSession?.model,
    isGatewayRunning,
    modelOptions.length,
    normalizedSelectedModel,
    providerLoading,
    setSessionModel,
  ]);

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col -m-6 overflow-hidden transition-colors duration-500 dark:bg-background'
      )}
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-end px-4 py-2">
        <ChatToolbar
          modelOptions={modelOptions}
          selectedModel={normalizedSelectedModel}
          defaultModelValue={normalizedDefaultModelValue}
          defaultModelShortLabel={defaultModelMeta.shortLabel}
          currentAgentLabel={currentAgentLabel}
          showAgentLabel={!canSwitchAgent}
          onModelChange={setSessionModel}
          onConfigureModels={() => navigate('/models')}
          modelDisabled={!isGatewayRunning}
          isEmpty={isEmpty}
        />
      </div>

      {/* Messages Area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {loading && !sending ? (
            <PageLoader
              compact
              title={t('loading.title', '正在加载对话')}
              description={t('loading.description', '正在同步当前会话内容，请稍候。')}
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
                  message={
                    (streamMsg
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
                        }) as RawMessage
                  }
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
              {sending && !pendingFinal && !hasAnyStreamContent && <TypingIndicator />}
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
        selectedModel={normalizedSelectedModel}
        defaultModelValue={normalizedDefaultModelValue}
        defaultModelShortLabel={defaultModelMeta.shortLabel}
        onModelChange={setSessionModel}
        onConfigureModels={() => navigate('/models')}
        modelDisabled={!isGatewayRunning}
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

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 px-1">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-slate-200/90 bg-slate-50 text-slate-700 shadow-[0_6px_20px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200">
        <Bot className="h-[18px] w-[18px]" />
      </div>
      <div className="rounded-[16px] border border-slate-200/80 bg-slate-50 px-5 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex gap-1.5">
          <span
            className="h-3 w-3 rounded-full bg-slate-400/70 animate-bounce dark:bg-slate-300/55"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="h-3 w-3 rounded-full bg-slate-400/70 animate-bounce dark:bg-slate-300/55"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="h-3 w-3 rounded-full bg-slate-400/70 animate-bounce dark:bg-slate-300/55"
            style={{ animationDelay: '300ms' }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Activity Indicator (shown between tool cycles) ─────────────

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  void phase;
  return (
    <div className="flex items-center gap-3 px-1">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-slate-200/90 bg-slate-50 text-slate-700 shadow-[0_6px_20px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200">
        <Bot className="h-[18px] w-[18px]" />
      </div>
      <div className="rounded-[16px] border border-slate-200/80 bg-slate-50 px-5 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingIcon className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
          <span>{i18n.t('chat:status.processingToolResults')}</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
