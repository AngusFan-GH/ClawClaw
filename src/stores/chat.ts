/**
 * Chat State Store
 * Manages chat messages, sessions, streaming, and thinking state.
 * Communicates with OpenClaw Gateway via renderer WebSocket RPC.
 */
import { create } from 'zustand';
import { normalizeChatTimestampForKey, normalizeChatTimestampMs, type ChatTimestamp } from '@/lib/chat-timestamps';
import { hostApiFetch } from '@/lib/host-api';
import { extractText } from '@/pages/Chat/message-utils';
import { historyContainsPendingUserMessage } from '@/pages/Chat/pending-user-message';
import { useGatewayStore } from './gateway';
import { getAppliedAgentsSnapshotState } from './agents';

// ── Types ────────────────────────────────────────────────────────

/** Metadata for locally-attached files (not from Gateway) */
export interface AttachedFileMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  preview: string | null;
  filePath?: string;
}

/** Raw message from OpenClaw chat.history */
export interface BtwInfo {
  question: string;
  isError?: boolean;
}

export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult' | 'compactionSummary';
  content: unknown; // string | ContentBlock[]
  timestamp?: ChatTimestamp;
  id?: string;
  idempotencyKey?: string;
  toolCallId?: string;
  toolName?: string;
  model?: string;
  usage?: Record<string, number>;
  cost?: Record<string, number>;
  details?: unknown;
  isError?: boolean;
  /** Local-only: file metadata for user-uploaded attachments (not sent to/from Gateway) */
  _attachedFiles?: AttachedFileMeta[];
  /** Present when this message is a BTW side-question response */
  btw?: BtwInfo;
}

/** Content block inside a message */
export interface ContentBlock {
  type: 'text' | 'image' | 'file' | 'thinking' | 'tool_use' | 'tool_result' | 'toolCall' | 'toolResult' | 'toolcall' | 'toolresult';
  text?: string;
  thinking?: string;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  /** Flat image format from Gateway tool results (no source wrapper) */
  data?: string;
  mimeType?: string;
  id?: string;
  name?: string;
  fileName?: string;
  filePath?: string;
  path?: string;
  url?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
}

/** Session from sessions.list */
export interface ChatSession {
  key: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  kind?: string;
  spawnedBy?: string;
  parentSessionKey?: string;
  forkedFromParent?: boolean;
  subagentRole?: string;
  thinkingLevel?: string;
  thinkingOptions?: string[];
  thinkingDefault?: string;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
  updatedAt?: number;
}

export interface ToolStatus {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  summary?: string;
  updatedAt: number;
}

export interface StreamSegment {
  text: string;
  ts: number;
}

export interface QueuedChatMessage {
  id: string;
  text: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    fileSize: number;
    stagedPath: string;
    preview: string | null;
  }>;
  pendingRunId?: string;
}

export interface CompactionStatus {
  phase: 'active' | 'retrying' | 'complete';
  runId: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface FallbackStatus {
  phase?: 'active' | 'cleared';
  selected: string;
  active: string;
  previous?: string;
  reason?: string;
  attempts: string[];
  occurredAt: number;
}

interface ToolStreamEntry {
  toolCallId: string;
  runId: string;
  sessionKey?: string;
  name: string;
  args?: unknown;
  output?: string;
  startedAt: number;
  updatedAt: number;
  message: RawMessage;
}

interface AgentStreamEvent {
  runId?: string;
  sessionKey?: string;
  stream?: string;
  seq?: number;
  ts?: number;
  data?: Record<string, unknown>;
}

interface LoadSessionsOptions {
  preferMostRecent?: boolean;
  preserveCurrent?: boolean;
  warmLabels?: boolean;
  silent?: boolean;
}

type SessionListResponse = {
  success?: boolean;
  sessions?: Array<Record<string, unknown>>;
  hasMore?: boolean;
  nextCursor?: string | null;
  total?: number;
};

type SessionHistoryResponse = {
  success?: boolean;
  sessionKey?: string;
  messages?: RawMessage[];
  hasMore?: boolean;
  nextCursor?: string | null;
  thinkingLevel?: string | null;
  total?: number;
};

interface ChatState {
  // Messages
  messages: RawMessage[];
  pendingUserMessage: RawMessage | null;
  pendingAssistantMessage: RawMessage | null;
  btwMessages: RawMessage[];
  loading: boolean;
  error: string | null;

  // Streaming
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  chatToolMessages: RawMessage[];
  chatStreamSegments: StreamSegment[];
  pendingFinal: boolean;
  terminalHistoryReconciling: boolean;
  queueFlushToken: number;
  lastTerminalRunId: string | null;
  chatQueue: QueuedChatMessage[];
  lastUserMessageAt: number | null;
  /** Images collected from tool results, attached to the next assistant message */
  pendingToolImages: AttachedFileMeta[];
  toolStreamById: Map<string, ToolStreamEntry>;
  toolStreamOrder: string[];
  compactionStatus: CompactionStatus | null;
  fallbackStatus: FallbackStatus | null;

  // Sessions
  sessions: ChatSession[];
  sessionsLoading: boolean;
  sessionsLoadingMore: boolean;
  sessionsHydrated: boolean;
  sessionsHasMore: boolean;
  sessionsNextCursor: string | null;
  currentSessionKey: string;
  currentAgentId: string;
  /** First user message text per session key, used as display label */
  sessionLabels: Record<string, string>;
  /** Last message timestamp (ms) per session key, used for sorting */
  sessionLastActivity: Record<string, number>;
  /** Locally-created sessions not yet materialized in Gateway */
  pendingLocalSessionKeys: Record<string, true>;
  /** Refresh the current session entry after slash commands that mutate session model. */
  pendingSessionModelRefresh: boolean;
  /** True when the latest chat.history response hit the client-side history window. */
  historyWindowLimited: boolean;
  hasEarlierHistory: boolean;
  loadingEarlierHistory: boolean;
  earlierHistoryCursor: string | null;

  // Thinking
  showThinking: boolean;
  thinkingLevel: string | null;
  allowedModelRefs: string[];
  defaultModelRef?: string;

  // Actions
  loadSessions: (options?: boolean | LoadSessionsOptions) => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  restoreSessionsAfterGatewayReady: () => Promise<void>;
  switchSession: (key: string) => void;
  newSession: (agentId?: string) => void;
  deleteSession: (key: string) => Promise<void>;
  cleanupEmptySession: () => void;
  setSessionModel: (model?: string) => Promise<void>;
  loadHistory: (quiet?: boolean) => Promise<void>;
  sendMessage: (
    text: string,
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      fileSize: number;
      stagedPath: string;
      preview: string | null;
    }>
  ) => Promise<void>;
  abortRun: () => Promise<void>;
  interruptActiveRunForPolicyChange: (message: string) => Promise<boolean>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  handleAgentEvent: (event: AgentStreamEvent) => void;
  handleBtwEvent: (btw: { question: string; text: string; isError?: boolean }) => void;
  handleGatewayStatusChange: (state: 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting') => void;
  requestQueueFlush: (runId?: string | null) => void;
  enqueueChatMessage: (item: Omit<QueuedChatMessage, 'id'> & { id?: string }) => void;
  removeQueuedMessage: (id: string) => void;
  clearChatQueue: () => void;
  clearPendingQueueItemsForRun: (runId?: string | null) => void;
  toggleThinking: () => void;
  refresh: () => Promise<void>;
  clearError: () => void;
  setModelGuard: (allowedModelRefs: string[], defaultModelRef?: string) => void;
  resolveSessionModelRef: (sessionKey?: string) => string | undefined;
  loadEarlierHistory: () => Promise<void>;
}

// Module-level timestamp tracking the last chat event received.
// Used by the safety timeout to avoid false-positive "no response" errors
// during tool-use conversations where streamingMessage is temporarily cleared
// between tool-result finals and the next delta.
let _lastChatEventAt = 0;

/** Normalize a timestamp to milliseconds. Handles numeric seconds and milliseconds. */
function toMs(ts: unknown): number {
  return normalizeChatTimestampMs(ts) ?? 0;
}

// Timer for terminal-state history reconciliation. OpenClaw's dashboard does
// not poll chat.history while the active run is streaming; chat events own the
// live transcript and history is reloaded after terminal events.
let _historyPollTimer: ReturnType<typeof setTimeout> | null = null;
let _historyLoadSeq = 0;
let _sessionRestorePromise: Promise<void> | null = null;
let _sessionRestoreRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _sessionTitleRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let _sessionTitleRefreshAttempts = 0;
let _initialHistoryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let _initialHistoryRefreshAttempts = 0;
const CHAT_HISTORY_PAGE_LIMIT = 200;
// Session restore retry backoff
const SESSION_RESTORE_INITIAL_DELAY_MS = 1000;
const SESSION_RESTORE_MAX_DELAY_MS = 15_000;
const SESSION_TITLE_REFRESH_DELAY_MS = 2500;
const SESSION_TITLE_REFRESH_MAX_ATTEMPTS = 3;
const INITIAL_HISTORY_REFRESH_DELAY_MS = 1500;
const INITIAL_HISTORY_REFRESH_MAX_ATTEMPTS = 4;
const SESSION_LIST_PAGE_LIMIT = 30;
// Hard timeouts (ms) — prevent indefinite hangs
const SESSIONS_LIST_TIMEOUT_MS = 10_000;
const HISTORY_LOAD_TIMEOUT_MS = 15_000;
const RESTORE_SAFETY_TIMEOUT_MS = 20_000;
const STARTUP_CHAT_HISTORY_RETRY_TIMEOUT_MS = 60_000;
const STARTUP_CHAT_HISTORY_DEFAULT_RETRY_MS = 500;
const STARTUP_CHAT_HISTORY_MAX_RETRY_MS = 5_000;
// OpenClaw defaults to a 120s LLM idle timeout when no explicit override is set.
// Keep the UI watchdog and send RPC slightly higher so Gateway/provider errors
// can surface before ClawClaw synthesizes its own timeout state.
const CHAT_SEND_TIMEOUT_MS = 135_000;
const CHAT_RESPONSE_WATCHDOG_TIMEOUT_MS = 135_000;

function getRawMessageKey(message: Partial<RawMessage>): string {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : '';
  if (toolCallId) return `tool:${toolCallId}`;
  const id = typeof message.id === 'string' ? message.id : '';
  if (id) return `msg:${id}`;
  const timestamp = normalizeChatTimestampForKey(message.timestamp);
  const role = typeof message.role === 'string' ? message.role : 'unknown';
  if (timestamp != null) return `msg:${role}:${timestamp}`;
  return `msg:${role}`;
}

let _compactionClearTimer: ReturnType<typeof setTimeout> | null = null;
let _fallbackClearTimer: ReturnType<typeof setTimeout> | null = null;
const COMPACTION_TOAST_DURATION_MS = 5000;
const FALLBACK_TOAST_DURATION_MS = 8000;

function clearCompactionTimer(): void {
  if (_compactionClearTimer) {
    clearTimeout(_compactionClearTimer);
    _compactionClearTimer = null;
  }
}

function clearFallbackTimer(): void {
  if (_fallbackClearTimer) {
    clearTimeout(_fallbackClearTimer);
    _fallbackClearTimer = null;
  }
}

function clearHistoryPoll(): void {
  if (_historyPollTimer) {
    clearTimeout(_historyPollTimer);
    _historyPollTimer = null;
  }
}

function clearSessionRestoreRetry(): void {
  if (_sessionRestoreRetryTimer) {
    clearTimeout(_sessionRestoreRetryTimer);
    _sessionRestoreRetryTimer = null;
  }
}

function clearSessionTitleRefreshRetry(resetAttempts = false): void {
  if (_sessionTitleRefreshTimer) {
    clearTimeout(_sessionTitleRefreshTimer);
    _sessionTitleRefreshTimer = null;
  }
  if (resetAttempts) {
    _sessionTitleRefreshAttempts = 0;
  }
}

function clearInitialHistoryRefreshRetry(resetAttempts = false): void {
  if (_initialHistoryRefreshTimer) {
    clearTimeout(_initialHistoryRefreshTimer);
    _initialHistoryRefreshTimer = null;
  }
  if (resetAttempts) {
    _initialHistoryRefreshAttempts = 0;
  }
}

function isGatewayDisconnectErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('gateway not connected')
    || normalized.includes('gateway connection closed')
    || normalized.includes('gateway process exited')
    || normalized.includes('rpc timeout: chat.send')
    || normalized.includes('connect handshake timeout')
    || normalized.includes('websocket closed before handshake');
}

function getGatewayStatusErrorMessage(state: 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting'): string | null {
  switch (state) {
    case 'reconnecting':
      return 'Gateway is reconnecting. The current response state is being preserved and will refresh when the Gateway is back.';
    case 'starting':
      return 'Gateway is starting. The current response state is being preserved and will refresh when the Gateway is back.';
    case 'stopped':
      return 'Gateway went offline while the response was in progress. Restart it and refresh the conversation.';
    case 'error':
      return 'Gateway failed while the response was in progress. Restart it and refresh the conversation.';
    default:
      return null;
  }
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function resolveModelLabel(provider: unknown, model: unknown): string | null {
  const modelValue = toTrimmedString(model);
  if (!modelValue) return null;
  const providerValue = toTrimmedString(provider);
  if (providerValue) {
    const prefix = `${providerValue}/`;
    if (modelValue.toLowerCase().startsWith(prefix.toLowerCase())) {
      const trimmedModel = modelValue.slice(prefix.length).trim();
      if (trimmedModel) {
        return `${providerValue}/${trimmedModel}`;
      }
    }
    return `${providerValue}/${modelValue}`;
  }
  const slashIndex = modelValue.indexOf('/');
  if (slashIndex > 0) {
    const p = modelValue.slice(0, slashIndex).trim();
    const m = modelValue.slice(slashIndex + 1).trim();
    if (p && m) {
      return `${p}/${m}`;
    }
  }
  return modelValue;
}

function parseFallbackAttemptSummaries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toTrimmedString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function parseFallbackAttempts(value: unknown): Array<{ provider: string; model: string; reason: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ provider: string; model: string; reason: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const provider = toTrimmedString(item.provider);
    const model = toTrimmedString(item.model);
    if (!provider || !model) continue;
    const reason =
      toTrimmedString(item.reason)?.replace(/_/g, ' ')
      ?? toTrimmedString(item.code)
      ?? (typeof item.status === 'number' ? `HTTP ${item.status}` : null)
      ?? toTrimmedString(item.error)
      ?? 'error';
    out.push({ provider, model, reason });
  }
  return out;
}

const DEFAULT_CANONICAL_PREFIX = 'agent:main';
export const DEFAULT_SESSION_KEY = `${DEFAULT_CANONICAL_PREFIX}:main`;
const CURRENT_SESSION_STORAGE_KEY = 'clawclaw:current-session-key';
const INITIAL_SESSION_KEY = loadPersistedCurrentSessionKey();
const INITIAL_AGENT_ID = getAgentIdFromSessionKey(INITIAL_SESSION_KEY) || 'main';

function loadPersistedCurrentSessionKey(): string {
  try {
    const stored = window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)?.trim();
    return stored || DEFAULT_SESSION_KEY;
  } catch {
    return DEFAULT_SESSION_KEY;
  }
}

function persistCurrentSessionKey(sessionKey: string): void {
  try {
    window.localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, sessionKey);
  } catch {
    // ignore persistence failures
  }
}

function isMainSessionKey(key: string): boolean {
  return key.endsWith(':main');
}

function isCronSessionKey(key: string): boolean {
  return key.includes(':cron:');
}

function isSubagentSessionKey(key: string): boolean {
  return key.includes(':subagent:') || key.includes(':acp:');
}

function isChatSidebarSessionKey(key: string): boolean {
  return key.startsWith('agent:') && !isCronSessionKey(key);
}

function buildAgentMainSessionKey(agentId: string, mainKey = 'main'): string {
  return `agent:${agentId}:${mainKey || 'main'}`;
}

function normalizeLoadSessionsOptions(
  options?: boolean | LoadSessionsOptions,
): Required<LoadSessionsOptions> {
  if (typeof options === 'boolean') {
    return {
      preferMostRecent: options,
      preserveCurrent: false,
      warmLabels: true,
      silent: false,
    };
  }

  return {
    preferMostRecent: Boolean(options?.preferMostRecent),
    preserveCurrent: Boolean(options?.preserveCurrent),
    warmLabels: options?.warmLabels ?? true,
    silent: Boolean(options?.silent),
  };
}

function normalizeSessionListResponse(data: SessionListResponse | null | undefined): ChatSession[] {
  const rawSessions = Array.isArray(data?.sessions) ? data.sessions : [];
  return rawSessions
    .map((s: Record<string, unknown>) => ({
      key: String(s.key || ''),
      label: s.label ? String(s.label) : undefined,
      displayName: s.displayName ? String(s.displayName) : undefined,
      derivedTitle: s.derivedTitle ? String(s.derivedTitle) : undefined,
      lastMessagePreview: s.lastMessagePreview ? String(s.lastMessagePreview) : undefined,
      kind: typeof s.kind === 'string' ? s.kind : undefined,
      spawnedBy: typeof s.spawnedBy === 'string' ? s.spawnedBy : undefined,
      parentSessionKey: typeof s.parentSessionKey === 'string' ? s.parentSessionKey : undefined,
      forkedFromParent: s.forkedFromParent === true,
      subagentRole: typeof s.subagentRole === 'string' ? s.subagentRole : undefined,
      thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
      model: s.model ? String(s.model) : undefined,
      modelProvider:
        typeof s.modelProvider === 'string'
          ? s.modelProvider
          : typeof s.provider === 'string'
            ? s.provider
            : undefined,
      contextTokens:
        typeof s.contextTokens === 'number'
          ? s.contextTokens
          : typeof s.contextTokens === 'string'
            ? Number(s.contextTokens)
            : typeof s.context_tokens === 'number'
              ? s.context_tokens
              : typeof s.context_tokens === 'string'
                ? Number(s.context_tokens)
                : undefined,
      updatedAt: toMs(s.updatedAt) || undefined,
    }))
    .filter((s: ChatSession) => s.key && isChatSidebarSessionKey(s.key));
}

function omitSessionKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([recordKey]) => recordKey !== key));
}

function removeSessionArtifacts<
  T extends {
    sessions: ChatSession[];
    sessionLabels: Record<string, string>;
    sessionLastActivity: Record<string, number>;
    pendingLocalSessionKeys: Record<string, true>;
  },
>(state: T, key: string): Pick<T, 'sessions' | 'sessionLabels' | 'sessionLastActivity' | 'pendingLocalSessionKeys'> {
  return {
    sessions: state.sessions.filter((session) => session.key !== key),
    sessionLabels: omitSessionKey(state.sessionLabels, key),
    sessionLastActivity: omitSessionKey(state.sessionLastActivity, key),
    pendingLocalSessionKeys: omitSessionKey(state.pendingLocalSessionKeys, key),
  };
}

function isEmptyEphemeralSession(
  sessionKey: string,
  messages: RawMessage[],
  pendingLocalSessionKeys: Record<string, true>,
  pendingUserMessage?: RawMessage | null,
  pendingAssistantMessage?: RawMessage | null,
): boolean {
  return (
    Boolean(pendingLocalSessionKeys[sessionKey])
    && messages.length === 0
    && !pendingUserMessage
    && !pendingAssistantMessage
  );
}

function normalizeModelRefs(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function resolveSessionModelRef(
  session: Pick<ChatSession, 'model' | 'modelProvider'> | undefined,
  allowedModelRefs: string[] = [],
): string | undefined {
  const rawModel = session?.model?.trim();
  if (!rawModel) return undefined;

  const exact = allowedModelRefs.find((ref) => ref === rawModel);
  if (exact) return exact;

  const provider = session?.modelProvider?.trim();
  if (provider && !rawModel.includes('/')) {
    const providerRef = `${provider}/${rawModel}`;
    const providerExact = allowedModelRefs.find((ref) => ref === providerRef);
    if (providerExact) return providerExact;

    const providerSuffixMatches = allowedModelRefs.filter(
      (ref) => ref.startsWith(`${provider}/`) && ref.split('/').pop() === rawModel,
    );
    if (providerSuffixMatches.length === 1) {
      return providerSuffixMatches[0];
    }

    return providerRef;
  }

  const suffixMatches = allowedModelRefs.filter((ref) => ref.split('/').pop() === rawModel);
  if (suffixMatches.length === 1) {
    return suffixMatches[0];
  }

  return rawModel;
}

function getMostRecentSessionKey(
  sessions: ChatSession[],
  sessionLastActivity: Record<string, number>
): string | undefined {
  const sorted = [...sessions].sort((left, right) => {
    const rightActivity = sessionLastActivity[right.key] ?? 0;
    const leftActivity = sessionLastActivity[left.key] ?? 0;
    if (rightActivity !== leftActivity) {
      return rightActivity - leftActivity;
    }
    if (left.key === DEFAULT_SESSION_KEY) return 1;
    if (right.key === DEFAULT_SESSION_KEY) return -1;
    return right.key.localeCompare(left.key);
  });
  return sorted[0]?.key;
}

export function resolveSessionSidebarTitle(session: Pick<ChatSession, 'derivedTitle' | 'label' | 'displayName' | 'key'>): string | undefined {
  const title = normalizeSessionTitleCandidate(session.derivedTitle || session.label || '');
  if (title) return title;
  const displayName = normalizeSessionTitleCandidate(session.displayName || '');
  if (displayName && displayName !== session.key && isMainSessionKey(session.key)) {
    return displayName;
  }
  return undefined;
}

function normalizeSidebarTitleForMatch(value?: string): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isRecentSessionMaterialization(
  pendingActivityMs: number | undefined,
  candidateActivityMs: number | undefined,
): boolean {
  if (!pendingActivityMs || !candidateActivityMs) return false;
  return Math.abs(candidateActivityMs - pendingActivityMs) <= 5 * 60 * 1000;
}

function findMaterializedSessionKey(params: {
  pendingKey: string;
  pendingLabel?: string;
  pendingActivityMs?: number;
  sessions: ChatSession[];
  sessionLabels: Record<string, string>;
  sessionLastActivity: Record<string, number>;
}): string | undefined {
  const { pendingKey, pendingLabel, pendingActivityMs, sessions, sessionLabels, sessionLastActivity } = params;
  const pendingAgentId = getAgentIdFromSessionKey(pendingKey);
  const normalizedPendingLabel = normalizeSidebarTitleForMatch(pendingLabel);
  // Only materialize a synthetic local session when we have a stable user-visible
  // title to match against. Empty "new chat" placeholders intentionally have no
  // label yet; mapping them to the latest real session would snap the UI back to
  // an older conversation when returning from another page.
  if (!normalizedPendingLabel) {
    return undefined;
  }
  const candidates = sessions.filter((session) => (
    session.key !== pendingKey
    && getAgentIdFromSessionKey(session.key) === pendingAgentId
    && isRecentSessionMaterialization(pendingActivityMs, sessionLastActivity[session.key] ?? session.updatedAt)
  ));

  if (candidates.length === 0) return undefined;

  const exactLabelMatches = candidates.filter((session) => {
    const label = sessionLabels[session.key] ?? resolveSessionSidebarTitle(session) ?? session.label ?? session.displayName;
    return normalizeSidebarTitleForMatch(label) === normalizedPendingLabel;
  });

  const rankedCandidates = (exactLabelMatches.length > 0 ? exactLabelMatches : candidates)
    .sort((left, right) => (sessionLastActivity[right.key] ?? right.updatedAt ?? 0) - (sessionLastActivity[left.key] ?? left.updatedAt ?? 0));

  if (rankedCandidates.length === 1) {
    return rankedCandidates[0].key;
  }

  const topActivity = sessionLastActivity[rankedCandidates[0].key] ?? rankedCandidates[0].updatedAt ?? 0;
  const runnerUpActivity = sessionLastActivity[rankedCandidates[1].key] ?? rankedCandidates[1].updatedAt ?? 0;
  return topActivity > runnerUpActivity ? rankedCandidates[0].key : undefined;
}

function hasResolvableSessionTitle(
  session: Pick<ChatSession, 'key' | 'label' | 'displayName' | 'derivedTitle'>,
  sessionLabels: Record<string, string>,
): boolean {
  return Boolean(sessionLabels[session.key] || resolveSessionSidebarTitle(session));
}

function shouldRetryInitialHistory(state: ChatState): boolean {
  if (useGatewayStore.getState().status.state !== 'running') return false;
  if (!state.sessionsHydrated || state.loading || state.sending || state.messages.length > 0) {
    return false;
  }
  if (state.pendingUserMessage || state.pendingAssistantMessage) return false;
  if (state.pendingLocalSessionKeys[state.currentSessionKey]) return false;
  return state.sessions.some((session) => session.key === state.currentSessionKey);
}

// ── Local image cache ─────────────────────────────────────────
// The Gateway doesn't store image attachments in session content blocks,
// so we cache them locally keyed by staged file path (which appears in the
// [media attached: <path> ...] reference in the Gateway's user message text).
// Keying by path avoids the race condition of keying by runId (which is only
// available after the RPC returns, but history may load before that).
const IMAGE_CACHE_KEY = 'clawclaw:image-cache';
const IMAGE_CACHE_MAX = 100; // max entries to prevent unbounded growth

function loadImageCache(): Map<string, AttachedFileMeta> {
  const raw = localStorage.getItem(IMAGE_CACHE_KEY);
  if (!raw) return new Map();

  try {
    const entries = JSON.parse(raw) as Array<[string, AttachedFileMeta]>;
    if (!Array.isArray(entries)) throw new Error('Cache entries must be an array');
    return new Map(entries);
  } catch (err) {
    // ✅ Fix HR-2: Corrupted localStorage data — clear it so we don't retry forever.
    console.warn('[loadImageCache] Corrupted cache data, clearing:', err);
    try {
      localStorage.removeItem(IMAGE_CACHE_KEY);
    } catch {
      // ignore cleanup failure
    }
    return new Map();
  }
}

function saveImageCache(cache: Map<string, AttachedFileMeta>): void {
  try {
    const entries = Array.from(cache.entries());
    const trimmed =
      entries.length > IMAGE_CACHE_MAX ? entries.slice(entries.length - IMAGE_CACHE_MAX) : entries;
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    // ✅ Fix HR-2: Log quota errors so they're visible during development.
    console.warn('[saveImageCache] Failed to persist image cache (quota exceeded?):', err);
  }
}

const _imageCache = loadImageCache();

/** Extract plain text from message content (string or content blocks) */
function getMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n');
  }
  return '';
}

function authoritativeHistoryContainsPendingUser(
  enrichedMessages: RawMessage[],
  pendingUserMessage: RawMessage | null,
  lastUserMessageAt: number | null,
): boolean {
  return historyContainsPendingUserMessage(enrichedMessages, pendingUserMessage, {
    optimisticTimestampMs: lastUserMessageAt ? toMs(lastUserMessageAt) : undefined,
  });
}

function normalizeComparableAssistantText(message: RawMessage | null | undefined): string {
  if (!message || message.role !== 'assistant') return '';
  if (!hasNonToolAssistantContent(message)) return '';
  return extractText(message).replace(/\s+/g, ' ').trim();
}

function authoritativeHistoryContainsPendingAssistant(
  enrichedMessages: RawMessage[],
  pendingAssistantMessage: RawMessage | null,
  lastUserMessageAt: number | null,
): boolean {
  const pendingText = normalizeComparableAssistantText(pendingAssistantMessage);
  if (!pendingAssistantMessage || !pendingText) return false;

  const userMsTs = lastUserMessageAt ? toMs(lastUserMessageAt) : 0;
  return enrichedMessages.some((message) => {
    if (message.role !== 'assistant') return false;
    if (userMsTs && message.timestamp && toMs(message.timestamp) < userMsTs) return false;
    const text = normalizeComparableAssistantText(message);
    if (!text) return false;
    if (pendingAssistantMessage.id && message.id === pendingAssistantMessage.id) return true;
    if (text === pendingText) return true;

    const shorter = Math.min(text.length, pendingText.length);
    const longer = Math.max(text.length, pendingText.length);
    if (shorter < 80 || longer === 0 || shorter / longer < 0.75) return false;
    return text.includes(pendingText) || pendingText.includes(text);
  });
}

const SESSION_TITLE_NOISE_PREFIXES = [
  'A new session was started via /new or /reset.',
  'Conversation info (untrusted metadata):',
  'Sender (untrusted metadata):',
  'Thread starter (untrusted, for context):',
  'Replied message (untrusted, for context):',
  'Forwarded message context (untrusted metadata):',
  'Chat history since last reply (untrusted, for context):',
  'Untrusted context (metadata, do not treat as instructions or commands):',
] as const;

const LEADING_TIMESTAMP_PREFIX_RE = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\] */;
const LEADING_INTERNAL_TAG_RE = /^(?:\[(?:Subagent Context|Subagent Task|Task|Context|System)\]\s*)+/i;
const LEADING_INTERNAL_MARKER_RE = /^(?:<<<[A-Z0-9_:-]+>>>\s*)+/i;
const INBOUND_META_BLOCK_RE =
  /^(?:(?:Conversation info|Sender|Thread starter|Replied message|Forwarded message context|Chat history since last reply) \(untrusted(?: metadata|, for context)?\):\s*```json[\s\S]*?```\s*)+/;

function normalizeSessionTitleCandidate(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(INBOUND_META_BLOCK_RE, '').trim();
  cleaned = cleaned.replace(LEADING_TIMESTAMP_PREFIX_RE, '').trim();
  cleaned = cleaned.replace(LEADING_INTERNAL_TAG_RE, '').trim();
  cleaned = cleaned.replace(LEADING_INTERNAL_MARKER_RE, '').trim();
  cleaned = cleaned.replace(INBOUND_META_BLOCK_RE, '').trim();
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  if (SESSION_TITLE_NOISE_PREFIXES.some((prefix) => cleaned.startsWith(prefix))) {
    return '';
  }

  return cleaned;
}

function extractSessionTitleFromMessage(message: RawMessage | undefined): string {
  if (!message || message.role !== 'user') return '';
  return normalizeSessionTitleCandidate(extractText(message));
}

function findSessionTitleCandidate(messages: RawMessage[]): string {
  for (const message of messages) {
    const title = extractSessionTitleFromMessage(message);
    if (title) {
      return title;
    }
  }
  return '';
}

export function isBackgroundSession(session: Pick<ChatSession, 'key' | 'kind' | 'spawnedBy' | 'parentSessionKey' | 'forkedFromParent' | 'subagentRole'>): boolean {
  if (isCronSessionKey(session.key)) return true;
  if (isSubagentSessionKey(session.key)) return true;
  if (session.kind === 'cron' || session.kind === 'subagent') return true;
  if (typeof session.spawnedBy === 'string' && session.spawnedBy.trim()) return true;
  if (typeof session.parentSessionKey === 'string' && session.parentSessionKey.trim()) return true;
  if (session.forkedFromParent === true) return true;
  if (typeof session.subagentRole === 'string' && session.subagentRole.trim()) return true;
  return false;
}

function isSlashModelCommandText(text: string): boolean {
  return /^\/model(?:\s|$)/i.test(text.trim());
}

/** Extract media file refs from [media attached: <path> (<mime>) | ...] patterns */
function extractMediaRefs(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ filePath: match[1], mimeType: match[2] });
  }
  return refs;
}

/** Map common file extensions to MIME types */
function mimeFromExtension(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    md: 'text/markdown',
    rtf: 'application/rtf',
    epub: 'application/epub+zip',
    // Archives
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    // Video
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    m4v: 'video/mp4',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Extract raw file paths from message text.
 * Detects absolute paths (Unix: / or ~/, Windows: C:\ etc.) ending with common file extensions.
 * Handles both image and non-image files, consistent with channel push message behavior.
 */
function extractRawFilePaths(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const seen = new Set<string>();
  const exts =
    'png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|epub|zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
  // Unix absolute paths (/... or ~/...) — lookbehind rejects mid-token slashes
  // (e.g. "path/to/file.mp4", "https://example.com/file.mp4")
  const unixRegex = new RegExp(
    `(?<![\\w./:])((?:\\/|~\\/)[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`,
    'gi'
  );
  // Windows absolute paths (C:\... D:\...) — lookbehind rejects drive letter glued to a word
  const winRegex = new RegExp(
    `(?<![\\w])([A-Za-z]:\\\\[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`,
    'gi'
  );
  for (const regex of [unixRegex, winRegex]) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const p = match[1];
      if (p && !seen.has(p)) {
        seen.add(p);
        refs.push({ filePath: p, mimeType: mimeFromExtension(p) });
      }
    }
  }
  return refs;
}

/**
 * Extract images from a content array (including nested tool_result content).
 * Converts them to AttachedFileMeta entries with preview set to data URL or remote URL.
 */
function extractImagesAsAttachedFiles(content: unknown): AttachedFileMeta[] {
  if (!Array.isArray(content)) return [];
  const files: AttachedFileMeta[] = [];

  for (const block of content as ContentBlock[]) {
    if (block.type === 'image') {
      // Path 1: Anthropic source-wrapped format {source: {type, media_type, data}}
      if (block.source) {
        const src = block.source;
        const mimeType = src.media_type || 'image/jpeg';

        if (src.type === 'base64' && src.data) {
          files.push({
            fileName: 'image',
            mimeType,
            fileSize: 0,
            preview: `data:${mimeType};base64,${src.data}`,
          });
        } else if (src.type === 'url' && src.url) {
          files.push({
            fileName: 'image',
            mimeType,
            fileSize: 0,
            preview: src.url,
          });
        }
      }
      // Path 2: Flat format from Gateway tool results {data, mimeType}
      else if (block.data) {
        const mimeType = block.mimeType || 'image/jpeg';
        files.push({
          fileName: 'image',
          mimeType,
          fileSize: 0,
          preview: `data:${mimeType};base64,${block.data}`,
        });
      }
    }
    // Recurse into tool_result content blocks
    if ((block.type === 'tool_result' || block.type === 'toolResult') && block.content) {
      files.push(...extractImagesAsAttachedFiles(block.content));
    }
  }
  return files;
}

/**
 * Build an AttachedFileMeta entry for a file ref, using cache if available.
 */
function makeAttachedFile(ref: { filePath: string; mimeType: string }): AttachedFileMeta {
  const cached = _imageCache.get(ref.filePath);
  if (cached) return { ...cached, filePath: ref.filePath };
  const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
  return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath };
}

/**
 * Extract file path from a tool call's arguments by toolCallId.
 * Searches common argument names: file_path, filePath, path, file.
 */
function getToolCallFilePath(msg: RawMessage, toolCallId: string): string | undefined {
  if (!toolCallId) return undefined;

  // Anthropic/normalized format — toolCall blocks in content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.id === toolCallId) {
        const args = (block.input ?? block.arguments) as Record<string, unknown> | undefined;
        if (args) {
          const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
          if (typeof fp === 'string') return fp;
        }
      }
    }
  }

  // OpenAI format — tool_calls array on the message itself
  const msgAny = msg as unknown as Record<string, unknown>;
  const toolCalls = msgAny.tool_calls ?? msgAny.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls as Array<Record<string, unknown>>) {
      if (tc.id !== toolCallId) continue;
      const fn = (tc.function ?? tc) as Record<string, unknown>;
      let args: Record<string, unknown> | undefined;
      try {
        args =
          typeof fn.arguments === 'string'
            ? JSON.parse(fn.arguments)
            : ((fn.arguments ?? fn.input) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
      if (args) {
        const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
        if (typeof fp === 'string') return fp;
      }
    }
  }

  return undefined;
}

/**
 * Restore _attachedFiles for messages loaded from history.
 * Handles:
 *   1. [media attached: path (mime) | path] patterns (attachment-button flow)
 *   2. Raw image file paths typed in message text (e.g. /Users/.../image.png)
 * Uses local cache for previews when available; missing previews are loaded async.
 */
function enrichWithCachedImages(messages: RawMessage[]): RawMessage[] {
  return messages.map((msg, idx) => {
    // Only process user and assistant messages; skip if already enriched
    if ((msg.role !== 'user' && msg.role !== 'assistant') || msg._attachedFiles) return msg;
    const text = getMessageText(msg.content);

    // Path 1: [media attached: path (mime) | path] — guaranteed format from attachment button
    const mediaRefs = extractMediaRefs(text);
    const mediaRefPaths = new Set(mediaRefs.map((r) => r.filePath));

    // Path 2: Raw file paths.
    // For assistant messages: scan own text AND the nearest preceding user message text,
    // but only for non-tool-only assistant messages (i.e. the final answer turn).
    // Tool-only messages (thinking + tool calls) should not show file previews — those
    // belong to the final answer message that comes after the tool results.
    // User messages never get raw-path previews so the image is not shown twice.
    let rawRefs: Array<{ filePath: string; mimeType: string }> = [];
    if (msg.role === 'assistant' && !isToolOnlyMessage(msg)) {
      // Own text
      rawRefs = extractRawFilePaths(text).filter((r) => !mediaRefPaths.has(r.filePath));

      // Nearest preceding user message text (look back up to 5 messages)
      const seenPaths = new Set(rawRefs.map((r) => r.filePath));
      for (let i = idx - 1; i >= Math.max(0, idx - 5); i--) {
        const prev = messages[i];
        if (!prev) break;
        if (prev.role === 'user') {
          const prevText = getMessageText(prev.content);
          for (const ref of extractRawFilePaths(prevText)) {
            if (!mediaRefPaths.has(ref.filePath) && !seenPaths.has(ref.filePath)) {
              seenPaths.add(ref.filePath);
              rawRefs.push(ref);
            }
          }
          break; // only use the nearest user message
        }
      }
    }

    const allRefs = [...mediaRefs, ...rawRefs];
    if (allRefs.length === 0) return msg;

    const files: AttachedFileMeta[] = allRefs.map((ref) => {
      const cached = _imageCache.get(ref.filePath);
      if (cached) return { ...cached, filePath: ref.filePath };
      const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
      return {
        fileName,
        mimeType: ref.mimeType,
        fileSize: 0,
        preview: null,
        filePath: ref.filePath,
      };
    });
    return { ...msg, _attachedFiles: files };
  });
}

/**
 * Async: load missing previews from disk via IPC for messages that have
 * _attachedFiles with null previews. Updates messages in-place and triggers re-render.
 * Handles both [media attached: ...] patterns and raw filePath entries.
 */
async function loadMissingPreviews(messages: RawMessage[]): Promise<boolean> {
  // Collect all image paths that need previews
  const needPreview: Array<{ filePath: string; mimeType: string }> = [];
  const seenPaths = new Set<string>();

  for (const msg of messages) {
    if (!msg._attachedFiles) continue;

    // Path 1: files with explicit filePath field (raw path detection or enriched refs)
    for (const file of msg._attachedFiles) {
      const fp = file.filePath;
      if (!fp || seenPaths.has(fp)) continue;
      // Images: need preview. Non-images: need file size (for FileCard display).
      const needsLoad = file.mimeType.startsWith('image/') ? !file.preview : file.fileSize === 0;
      if (needsLoad) {
        seenPaths.add(fp);
        needPreview.push({ filePath: fp, mimeType: file.mimeType });
      }
    }

    // Path 2: [media attached: ...] patterns (legacy — in case filePath wasn't stored)
    if (msg.role === 'user') {
      const text = getMessageText(msg.content);
      const refs = extractMediaRefs(text);
      for (let i = 0; i < refs.length; i++) {
        const file = msg._attachedFiles[i];
        const ref = refs[i];
        if (!file || !ref || seenPaths.has(ref.filePath)) continue;
        const needsLoad = ref.mimeType.startsWith('image/') ? !file.preview : file.fileSize === 0;
        if (needsLoad) {
          seenPaths.add(ref.filePath);
          needPreview.push(ref);
        }
      }
    }
  }

  if (needPreview.length === 0) return false;

  try {
    const thumbnails = await hostApiFetch<
      Record<string, { preview: string | null; fileSize: number }>
    >('/api/files/thumbnails', {
      method: 'POST',
      body: JSON.stringify({ paths: needPreview }),
    });

    let updated = false;
    for (const msg of messages) {
      if (!msg._attachedFiles) continue;

      // Update files that have filePath
      for (const file of msg._attachedFiles) {
        const fp = file.filePath;
        if (!fp) continue;
        const thumb = thumbnails[fp];
        if (thumb && (thumb.preview || thumb.fileSize)) {
          if (thumb.preview) file.preview = thumb.preview;
          if (thumb.fileSize) file.fileSize = thumb.fileSize;
          _imageCache.set(fp, { ...file });
          updated = true;
        }
      }

      // Legacy: update by index for [media attached: ...] refs
      if (msg.role === 'user') {
        const text = getMessageText(msg.content);
        const refs = extractMediaRefs(text);
        for (let i = 0; i < refs.length; i++) {
          const file = msg._attachedFiles[i];
          const ref = refs[i];
          if (!file || !ref || file.filePath) continue; // skip if already handled via filePath
          const thumb = thumbnails[ref.filePath];
          if (thumb && (thumb.preview || thumb.fileSize)) {
            if (thumb.preview) file.preview = thumb.preview;
            if (thumb.fileSize) file.fileSize = thumb.fileSize;
            _imageCache.set(ref.filePath, { ...file });
            updated = true;
          }
        }
      }
    }
    if (updated) saveImageCache(_imageCache);
    return updated;
  } catch (err) {
    console.warn('[loadMissingPreviews] Failed:', err);
    return false;
  }
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const parts = sessionKey.split(':');
  return parts[1] || 'main';
}

function getCanonicalPrefixFromSessions(sessions: ChatSession[]): string | null {
  const canonical = sessions.find((s) => s.key.startsWith('agent:'))?.key;
  if (!canonical) return null;
  const parts = canonical.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

function canonicalizeSessionKey(key: string, sessions: ChatSession[]): string {
  const trimmed = key.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('agent:')) return trimmed;
  const prefix = getCanonicalPrefixFromSessions(sessions) ?? DEFAULT_CANONICAL_PREFIX;
  return `${prefix}:${trimmed}`;
}

function sessionKeysMatch(currentKey: string, incomingKey: string, sessions: ChatSession[]): boolean {
  if (!currentKey || !incomingKey) return currentKey === incomingKey;
  if (currentKey === incomingKey) return true;
  return canonicalizeSessionKey(currentKey, sessions) === canonicalizeSessionKey(incomingKey, sessions);
}

/** Detect assistant messages whose text is purely NO_REPLY sentinel — filter from history display. */
const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/;
const SYNTHETIC_TRANSCRIPT_REPAIR_RESULT =
  '[openclaw] missing tool result in session history; inserted synthetic error result for transcript repair.';

function isSilentReplyText(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text);
}

function isAssistantSilentReply(message: RawMessage | undefined): boolean {
  if (!message || typeof message !== 'object') return false;
  const msg = message as unknown as Record<string, unknown>;
  const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
  if (role !== 'assistant') return false;
  if (typeof msg.text === 'string') return isSilentReplyText(msg.text);
  const text = extractTextFromContent(msg.content);
  return typeof text === 'string' && isSilentReplyText(text);
}

function isSyntheticTranscriptRepairToolResult(message: RawMessage | undefined): boolean {
  if (!message || typeof message !== 'object') return false;
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  if (!isToolResultRole(role)) return false;
  return extractTextFromContent(message.content).trim() === SYNTHETIC_TRANSCRIPT_REPAIR_RESULT;
}

function isRuntimeSystemInjection(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (/^System\s*\(untrusted\)\s*:/i.test(normalized)) return true;
  if (
    /An async command you ran earlier has completed/i.test(normalized)
    && /Do not relay it to the user unless explicitly requested/i.test(normalized)
  ) {
    return true;
  }
  if (
    /^Current time\s*:/i.test(normalized)
    && /^Current time\s*:[^\n]*\/\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC\s*$/i.test(normalized)
  ) {
    return true;
  }
  if (/Handle the result internally\. Do not relay it to the user/i.test(normalized)) {
    return true;
  }
  return false;
}

function isInternalHistoryMessage(message: RawMessage | undefined): boolean {
  if (!message || typeof message !== 'object') return false;
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  if (role === 'system') return true;
  if (isAssistantSilentReply(message)) return true;
  if (isSyntheticTranscriptRepairToolResult(message)) return true;
  if (role === 'user' || role === 'assistant') {
    const msg = message as unknown as Record<string, unknown>;
    const text = typeof msg.text === 'string' ? msg.text : getMessageText(message.content);
    return isRuntimeSystemInjection(text);
  }
  return false;
}

function isRetryableStartupHistoryError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  if (
    !normalized.includes('chat.history')
    && !normalized.includes('session history')
    && !normalized.includes('/api/sessions/history')
  ) {
    return false;
  }
  return (
    normalized.includes('unavailable')
    || normalized.includes('gateway startup')
    || normalized.includes('during gateway startup')
    || normalized.includes('retryable')
  );
}

function resolveStartupRetryDelayMs(err: unknown): number {
  const message = err instanceof Error ? err.message : String(err);
  const retryAfterMatch = message.match(/retryAfterMs["':=\s]+(\d+)/i)
    ?? message.match(/retry[- ]after["':=\s]+(\d+)/i);
  const retryAfterMs = retryAfterMatch ? Number(retryAfterMatch[1]) : STARTUP_CHAT_HISTORY_DEFAULT_RETRY_MS;
  return Math.min(
    Math.max(Number.isFinite(retryAfterMs) ? retryAfterMs : STARTUP_CHAT_HISTORY_DEFAULT_RETRY_MS, 100),
    STARTUP_CHAT_HISTORY_MAX_RETRY_MS,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isToolOnlyMessage(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (isToolResultRole(message.role)) return true;

  const msg = message as unknown as Record<string, unknown>;
  const content = message.content;

  // Check OpenAI-format tool_calls field (real-time streaming from OpenAI-compatible models)
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  const hasOpenAITools = Array.isArray(toolCalls) && toolCalls.length > 0;

  if (!Array.isArray(content)) {
    // Content is not an array — check if there's OpenAI-format tool_calls
    if (hasOpenAITools) {
      // Has tool calls but content might be empty/string — treat as tool-only
      // if there's no meaningful text content
      const textContent = typeof content === 'string' ? content.trim() : '';
      return textContent.length === 0;
    }
    return false;
  }

  let hasTool = hasOpenAITools;
  let hasText = false;
  let hasNonToolContent = false;

  for (const block of content as ContentBlock[]) {
    if (
      block.type === 'tool_use' ||
      block.type === 'tool_result' ||
      block.type === 'toolCall' ||
      block.type === 'toolResult' ||
      block.type === 'toolcall' ||
      block.type === 'toolresult'
    ) {
      hasTool = true;
      continue;
    }
    if (block.type === 'text' && block.text && block.text.trim()) {
      hasText = true;
      continue;
    }
    // Only actual image output disqualifies a tool-only message.
    // Thinking blocks are internal reasoning that can accompany tool_use — they
    // should NOT prevent the message from being treated as an intermediate tool step.
    if (block.type === 'image') {
      hasNonToolContent = true;
    }
  }

  return hasTool && !hasText && !hasNonToolContent;
}

function isToolResultRole(role: unknown): boolean {
  if (!role) return false;
  const normalized = String(role).toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function truncateText(text: string, limit = 120_000): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n… truncated (${text.length} chars, showing first ${limit}).`;
}

function formatToolOutput(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? truncateText(trimmed) : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const textContent = extractTextFromContent(value);
  if (textContent.trim()) {
    return truncateText(textContent.trim());
  }
  try {
    return truncateText(JSON.stringify(value, null, 2));
  } catch {
    return String(value);
  }
}

function buildToolStreamMessage(entry: ToolStreamEntry): RawMessage {
  const content: ContentBlock[] = [
    {
      type: 'toolCall',
      id: entry.toolCallId,
      name: entry.name,
      arguments: entry.args ?? {},
    },
  ];
  if (entry.output) {
    content.push({
      type: 'toolResult',
      id: entry.toolCallId,
      name: entry.name,
      text: entry.output,
    });
  }
  return {
    role: 'assistant',
    toolCallId: entry.toolCallId,
    toolName: entry.name,
    timestamp: entry.startedAt,
    content,
  };
}

function resetToolStreamState(_state: Pick<ChatState, 'toolStreamById' | 'toolStreamOrder'>): Pick<ChatState, 'toolStreamById' | 'toolStreamOrder' | 'chatToolMessages' | 'chatStreamSegments'> {
  return {
    toolStreamById: new Map<string, ToolStreamEntry>(),
    toolStreamOrder: [],
    chatToolMessages: [],
    chatStreamSegments: [],
  };
}

function clearPendingMessageState(): Pick<ChatState, 'pendingUserMessage' | 'pendingAssistantMessage'> {
  return {
    pendingUserMessage: null,
    pendingAssistantMessage: null,
  };
}

function resetStreamingPresentationState(): Pick<ChatState, 'streamingText' | 'streamingMessage' | 'streamingTools' | 'pendingToolImages'> {
  return {
    streamingText: '',
    streamingMessage: null,
    streamingTools: [],
    pendingToolImages: [],
  };
}

function resetChatRuntimeActivity(
  state: Pick<ChatState, 'toolStreamById' | 'toolStreamOrder'>,
): Pick<
  ChatState,
  | 'pendingUserMessage'
  | 'pendingAssistantMessage'
  | 'streamingText'
  | 'streamingMessage'
  | 'streamingTools'
  | 'pendingToolImages'
  | 'toolStreamById'
  | 'toolStreamOrder'
  | 'chatToolMessages'
  | 'chatStreamSegments'
> {
  return {
    ...clearPendingMessageState(),
    ...resetStreamingPresentationState(),
    ...resetToolStreamState(state),
  };
}

function buildAssistantMessageFromStream(
  state: Pick<ChatState, 'streamingText' | 'streamingMessage'>,
  runId: string,
): RawMessage | null {
  const currentStream = state.streamingMessage as RawMessage | null;
  const streamedText =
    state.streamingText.trim()
    || (currentStream && typeof currentStream === 'object'
      ? extractTextFromContent(currentStream.content).trim()
      : '');

  if (!streamedText || isSilentReplyText(streamedText)) return null;

  return {
    role: 'assistant',
    id: `stream-final-${runId || Date.now()}`,
    content: [{ type: 'text', text: streamedText }],
    timestamp: Date.now(),
  };
}

function summarizeToolOutput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  const summaryLines = lines.slice(0, 2);
  let summary = summaryLines.join(' / ');
  if (summary.length > 160) {
    summary = `${summary.slice(0, 157)}...`;
  }
  return summary;
}

function normalizeToolStatus(
  rawStatus: unknown,
  fallback: 'running' | 'completed'
): ToolStatus['status'] {
  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'completed' || status === 'success' || status === 'done') return 'completed';
  return fallback;
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractToolUseUpdates(message: unknown): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const updates: ToolStatus[] = [];

  // Path 1: Anthropic/normalized format — tool blocks inside content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (
        (block.type !== 'tool_use' && block.type !== 'toolCall' && block.type !== 'toolcall')
        || !block.name
      ) continue;
      updates.push({
        id: block.id || block.name,
        toolCallId: block.id,
        name: block.name,
        status: 'running',
        updatedAt: Date.now(),
      });
    }
  }

  // Path 2: OpenAI format — tool_calls array on the message itself
  if (updates.length === 0) {
    const toolCalls = msg.tool_calls ?? msg.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<Record<string, unknown>>) {
        const fn = (tc.function ?? tc) as Record<string, unknown>;
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!name) continue;
        const id = typeof tc.id === 'string' ? tc.id : name;
        updates.push({
          id,
          toolCallId: typeof tc.id === 'string' ? tc.id : undefined,
          name,
          status: 'running',
          updatedAt: Date.now(),
        });
      }
    }
  }

  return updates;
}

function extractToolResultBlocks(message: unknown, eventState: string): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  if (!Array.isArray(content)) return [];

  const updates: ToolStatus[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'tool_result' && block.type !== 'toolResult' && block.type !== 'toolresult') continue;
    const outputText = extractTextFromContent(block.content ?? block.text ?? '');
    const summary = summarizeToolOutput(outputText);
    updates.push({
      id: block.id || block.name || 'tool',
      toolCallId: block.id,
      name: block.name || block.id || 'tool',
      status: normalizeToolStatus(undefined, eventState === 'delta' ? 'running' : 'completed'),
      summary,
      updatedAt: Date.now(),
    });
  }

  return updates;
}

function extractToolResultUpdate(message: unknown, eventState: string): ToolStatus | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
  if (!isToolResultRole(role)) return null;

  const toolName =
    typeof msg.toolName === 'string' ? msg.toolName : typeof msg.name === 'string' ? msg.name : '';
  const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
  const details =
    msg.details && typeof msg.details === 'object'
      ? (msg.details as Record<string, unknown>)
      : undefined;
  const rawStatus = msg.status ?? details?.status;
  const fallback = eventState === 'delta' ? 'running' : 'completed';
  const status = normalizeToolStatus(rawStatus, fallback);
  const durationMs = parseDurationMs(
    details?.durationMs ?? details?.duration ?? (msg as Record<string, unknown>).durationMs
  );

  const outputText =
    details && typeof details.aggregated === 'string'
      ? details.aggregated
      : extractTextFromContent(msg.content);
  const summary =
    summarizeToolOutput(outputText) ??
    summarizeToolOutput(String(details?.error ?? msg.error ?? ''));

  const name = toolName || toolCallId || 'tool';
  const id = toolCallId || name;

  return {
    id,
    toolCallId,
    name,
    status,
    durationMs,
    summary,
    updatedAt: Date.now(),
  };
}

function mergeToolStatus(
  existing: ToolStatus['status'],
  incoming: ToolStatus['status']
): ToolStatus['status'] {
  const order: Record<ToolStatus['status'], number> = { running: 0, completed: 1, error: 2 };
  return order[incoming] >= order[existing] ? incoming : existing;
}

function upsertToolStatuses(current: ToolStatus[], updates: ToolStatus[]): ToolStatus[] {
  if (updates.length === 0) return current;
  const next = [...current];
  for (const update of updates) {
    const key = update.toolCallId || update.id || update.name;
    if (!key) continue;
    const index = next.findIndex((tool) => (tool.toolCallId || tool.id || tool.name) === key);
    if (index === -1) {
      next.push(update);
      continue;
    }
    const existing = next[index];
    next[index] = {
      ...existing,
      ...update,
      name: update.name || existing.name,
      status: mergeToolStatus(existing.status, update.status),
      durationMs: update.durationMs ?? existing.durationMs,
      summary: update.summary ?? existing.summary,
      updatedAt: update.updatedAt || existing.updatedAt,
    };
  }
  return next;
}

function collectToolUpdates(message: unknown, eventState: string): ToolStatus[] {
  const updates: ToolStatus[] = [];
  const toolResultUpdate = extractToolResultUpdate(message, eventState);
  if (toolResultUpdate) updates.push(toolResultUpdate);
  updates.push(...extractToolResultBlocks(message, eventState));
  updates.push(...extractToolUseUpdates(message));
  return updates;
}

function mergeStreamingText(current: string, incoming: string): string {
  const left = current || '';
  const right = incoming || '';
  if (!left) return right;
  if (!right) return left;
  if (right.startsWith(left)) return right;
  if (left.startsWith(right)) return left;

  const maxOverlap = Math.min(left.length, right.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (left.slice(-overlap) === right.slice(0, overlap)) {
      return `${left}${right.slice(overlap)}`;
    }
  }

  return right.length >= left.length ? right : left;
}

function mergeContentBlock(current: ContentBlock, incoming: ContentBlock): ContentBlock {
  if (current.type !== incoming.type) return incoming;

  if (incoming.type === 'text') {
    return {
      ...current,
      ...incoming,
      text: mergeStreamingText(current.text || '', incoming.text || ''),
    };
  }

  if (incoming.type === 'thinking') {
    return {
      ...current,
      ...incoming,
      thinking: mergeStreamingText(current.thinking || '', incoming.thinking || ''),
    };
  }

  if (
    (incoming.type === 'tool_result' || incoming.type === 'toolResult' || incoming.type === 'toolresult')
    && Array.isArray(current.content)
    && Array.isArray(incoming.content)
  ) {
    return {
      ...current,
      ...incoming,
      content: mergeStreamingContentBlocks(current.content as ContentBlock[], incoming.content as ContentBlock[]),
    };
  }

  return {
    ...current,
    ...incoming,
  };
}

function findMatchingBlockIndex(blocks: ContentBlock[], incoming: ContentBlock): number {
  if (incoming.id) {
    const byId = blocks.findIndex((block) => block.type === incoming.type && block.id === incoming.id);
    if (byId !== -1) return byId;
  }

  if (incoming.type === 'text' || incoming.type === 'thinking') {
    return blocks.findIndex((block) => block.type === incoming.type);
  }

  if (incoming.type === 'tool_use' || incoming.type === 'toolCall' || incoming.type === 'toolcall') {
    return blocks.findIndex(
      (block) =>
        block.type === incoming.type
        && ((incoming.id && block.id === incoming.id) || (incoming.name && block.name === incoming.name)),
    );
  }

  if (incoming.type === 'tool_result' || incoming.type === 'toolResult' || incoming.type === 'toolresult') {
    return blocks.findIndex(
      (block) =>
        block.type === incoming.type
        && ((incoming.id && block.id === incoming.id) || (incoming.name && block.name === incoming.name)),
    );
  }

  if (incoming.type === 'image') {
    return blocks.findIndex(
      (block) =>
        block.type === incoming.type
        && ((incoming.data && block.data === incoming.data) || (incoming.source?.url && block.source?.url === incoming.source.url)),
    );
  }

  return -1;
}

function mergeStreamingContentBlocks(current: ContentBlock[], incoming: ContentBlock[]): ContentBlock[] {
  if (current.length === 0) return incoming;
  if (incoming.length === 0) return current;

  const merged = [...current];
  for (const block of incoming) {
    const index = findMatchingBlockIndex(merged, block);
    if (index === -1) {
      merged.push(block);
      continue;
    }
    merged[index] = mergeContentBlock(merged[index], block);
  }
  return merged;
}

function mergeStreamingMessages(current: unknown, incoming: unknown): unknown {
  if (!incoming || typeof incoming !== 'object') return current;
  if (!current || typeof current !== 'object') return incoming;

  const prev = current as RawMessage;
  const next = incoming as RawMessage;
  const prevContent = prev.content;
  const nextContent = next.content;

  let mergedContent = nextContent;
  if (typeof prevContent === 'string' && typeof nextContent === 'string') {
    mergedContent = mergeStreamingText(prevContent, nextContent);
  } else if (Array.isArray(prevContent) && Array.isArray(nextContent)) {
    mergedContent = mergeStreamingContentBlocks(prevContent as ContentBlock[], nextContent as ContentBlock[]);
  } else if (Array.isArray(prevContent) && typeof nextContent === 'string') {
    mergedContent = mergeStreamingContentBlocks(prevContent as ContentBlock[], [{ type: 'text', text: nextContent }]);
  } else if (typeof prevContent === 'string' && Array.isArray(nextContent)) {
    mergedContent = mergeStreamingContentBlocks([{ type: 'text', text: prevContent }], nextContent as ContentBlock[]);
  }

  return {
    ...prev,
    ...next,
    role: next.role || prev.role,
    content: mergedContent,
    timestamp: next.timestamp ?? prev.timestamp,
    _attachedFiles: next._attachedFiles || prev._attachedFiles,
  } satisfies RawMessage;
}

function syncToolStreamMessages(
  toolStreamById: Map<string, ToolStreamEntry>,
  toolStreamOrder: string[]
): RawMessage[] {
  return toolStreamOrder
    .map((id) => toolStreamById.get(id)?.message)
    .filter((message): message is RawMessage => Boolean(message));
}

function trimToolStream(
  toolStreamById: Map<string, ToolStreamEntry>,
  toolStreamOrder: string[],
  limit = 50
): { toolStreamById: Map<string, ToolStreamEntry>; toolStreamOrder: string[] } {
  if (toolStreamOrder.length <= limit) {
    return { toolStreamById, toolStreamOrder };
  }
  const nextOrder = [...toolStreamOrder];
  const nextById = new Map(toolStreamById);
  const overflow = nextOrder.length - limit;
  const removed = nextOrder.splice(0, overflow);
  for (const id of removed) {
    nextById.delete(id);
  }
  return { toolStreamById: nextById, toolStreamOrder: nextOrder };
}

function hasNonToolAssistantContent(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (typeof message.content === 'string' && message.content.trim()) return true;

  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text && block.text.trim()) return true;
      if (block.type === 'thinking' && block.thinking && block.thinking.trim()) return true;
      if (block.type === 'image') return true;
    }
  }

  const msg = message as unknown as Record<string, unknown>;
  if (typeof msg.text === 'string' && msg.text.trim()) return true;

  return false;
}

function getMessageStopReason(message: RawMessage | unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const rawStopReason = msg.stopReason ?? msg.stop_reason;
  if (typeof rawStopReason !== 'string') return null;
  const normalized = rawStopReason.trim().toLowerCase();
  return normalized || null;
}

function hasPendingToolUse(message: RawMessage | undefined): boolean {
  if (!message) return false;
  const reason = getMessageStopReason(message);
  if (reason === 'tool_use' || reason === 'tooluse') return true;

  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'tool_use' || block.type === 'toolCall') return true;
    }
  }

  const msg = message as unknown as Record<string, unknown>;
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) return true;

  return false;
}

function isTerminalAssistantErrorMessage(message: RawMessage | unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  return /\[assistant turn failed/i.test(getMessageText((message as RawMessage).content));
}

function isRealUserBoundaryMessage(msg: RawMessage): boolean {
  if (msg.role !== 'user') return false;
  if (!Array.isArray(msg.content)) return true;
  const blocks = msg.content as Array<{ type?: string }>;
  return blocks.length === 0 || !blocks.every((block) => block.type === 'tool_result' || block.type === 'toolResult');
}

function postUserSegmentMessages(filteredMessages: RawMessage[]): RawMessage[] {
  for (let i = filteredMessages.length - 1; i >= 0; i -= 1) {
    if (isRealUserBoundaryMessage(filteredMessages[i])) {
      return filteredMessages.slice(i + 1);
    }
  }
  return [];
}

function hasCachedActiveUserRun(sessionKey: string): boolean {
  const cached = getCachedSessionRunState(sessionKey);
  return cached.sending || cached.activeRunId != null || cached.pendingFinal;
}

function getCachedSessionRunState(_sessionKey: string): { sending: boolean; activeRunId: string | null; pendingFinal: boolean } {
  const state = useChatStore.getState();
  return {
    sending: state.sending,
    activeRunId: state.activeRunId,
    pendingFinal: state.pendingFinal,
  };
}

function segmentHasOpenToolRun(segmentMessages: RawMessage[]): boolean {
  if (segmentMessages.length === 0) return false;
  const hasToolActivity = segmentMessages.some(
    (message) => message.role === 'assistant' && (hasPendingToolUse(message) || isToolOnlyMessage(message)),
  );
  if (!hasToolActivity) return false;

  let lastToolUseOffset = -1;
  for (let i = segmentMessages.length - 1; i >= 0; i -= 1) {
    const message = segmentMessages[i];
    if (message.role === 'assistant' && (hasPendingToolUse(message) || isToolOnlyMessage(message))) {
      lastToolUseOffset = i;
      break;
    }
  }

  return !segmentMessages.some((message, index) => {
    if (index <= lastToolUseOffset) return false;
    if (message.role !== 'assistant') return false;
    if (hasPendingToolUse(message)) return false;
    return hasNonToolAssistantContent(message);
  });
}

/** True when the post-user segment has real run output (not a thinking-only stub). */
function hasMeaningfulAssistantProgressAfterLastUser(messages: RawMessage[]): boolean {
  const segment = postUserSegmentMessages(messages);
  return segment.some((msg) => {
    if (msg.role !== 'assistant') return false;
    if (hasPendingToolUse(msg) || isToolOnlyMessage(msg)) return true;
    return hasNonToolAssistantContent(msg);
  });
}


export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  pendingUserMessage: null,
  pendingAssistantMessage: null,
  btwMessages: [],
  loading: false,
  error: null,

  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingMessage: null,
  streamingTools: [],
  chatToolMessages: [],
  chatStreamSegments: [],
  compactionStatus: null,
  fallbackStatus: null,
  pendingFinal: false,
  terminalHistoryReconciling: false,
  queueFlushToken: 0,
  lastTerminalRunId: null,
  chatQueue: [],
  lastUserMessageAt: null,
  pendingToolImages: [],
  toolStreamById: new Map<string, ToolStreamEntry>(),
  toolStreamOrder: [],

  sessions: [{ key: INITIAL_SESSION_KEY, displayName: INITIAL_SESSION_KEY }],
  sessionsLoading: false,
  sessionsLoadingMore: false,
  sessionsHydrated: false,
  sessionsHasMore: false,
  sessionsNextCursor: null,
  currentSessionKey: INITIAL_SESSION_KEY,
  currentAgentId: INITIAL_AGENT_ID,
  sessionLabels: {},
  sessionLastActivity: { [INITIAL_SESSION_KEY]: Date.now() },
  pendingLocalSessionKeys: {},
  pendingSessionModelRefresh: false,
  historyWindowLimited: false,
  hasEarlierHistory: false,
  loadingEarlierHistory: false,
  earlierHistoryCursor: null,

  showThinking: true,
  thinkingLevel: null,
  allowedModelRefs: [],
  defaultModelRef: undefined,

  // ── Load sessions via sessions.list ──

  setModelGuard: (allowedModelRefs, defaultModelRef) => {
    const normalizedAllowed = normalizeModelRefs(allowedModelRefs);
    const normalizedDefault = defaultModelRef?.trim() || undefined;
    set({
      allowedModelRefs: normalizedAllowed,
      defaultModelRef: normalizedDefault,
    });
  },

  resolveSessionModelRef: (sessionKey) => {
    const { sessions, currentSessionKey, allowedModelRefs } = get();
    const targetKey = sessionKey || currentSessionKey;
    const session = sessions.find((item) => item.key === targetKey);
    return resolveSessionModelRef(session, allowedModelRefs);
  },

  requestQueueFlush: (runId) => {
    get().clearPendingQueueItemsForRun(runId);
    set((s) => ({
      queueFlushToken: s.queueFlushToken + 1,
      lastTerminalRunId: runId?.trim() || null,
    }));
  },

  enqueueChatMessage: (item) => {
    const text = item.text.trim();
    if (!text && (!item.attachments || item.attachments.length === 0)) {
      return;
    }
    set((s) => ({
      chatQueue: [
        ...s.chatQueue,
        {
          ...item,
          id: item.id || crypto.randomUUID(),
          text,
        },
      ],
    }));
  },

  removeQueuedMessage: (id) => {
    set((s) => ({ chatQueue: s.chatQueue.filter((item) => item.id !== id) }));
  },

  clearChatQueue: () => {
    set({ chatQueue: [] });
  },

  clearPendingQueueItemsForRun: (runId) => {
    const normalizedRunId = runId?.trim();
    if (!normalizedRunId) {
      return;
    }
    set((s) => ({
      chatQueue: s.chatQueue.filter((item) => item.pendingRunId !== normalizedRunId),
    }));
  },

  loadSessions: async (options) => {
    const { preferMostRecent, preserveCurrent, warmLabels, silent } = normalizeLoadSessionsOptions(options);
    if (!silent) {
      set({ sessionsLoading: true });
    }
    try {
      // Timeout guard: prevents indefinite hang if Gateway is degraded and
      // doesn't respond to sessions.list (e.g. during context merge or overload).
      const currentSessionKeyForRequest = get().currentSessionKey;
      const data = await Promise.race([
        hostApiFetch<SessionListResponse>('/api/sessions/list', {
          method: 'POST',
          body: JSON.stringify({
            limit: SESSION_LIST_PAGE_LIMIT,
            includeKeys: preserveCurrent && currentSessionKeyForRequest ? [currentSessionKeyForRequest] : [],
          }),
        }),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('sessions.list timed out')), SESSIONS_LIST_TIMEOUT_MS)
        ),
      ]);
      if (data) {
        const sessions = normalizeSessionListResponse(data);
        const realSessionKeys = new Set(sessions.map((session) => session.key));

        const canonicalBySuffix = new Map<string, string>();
        for (const session of sessions) {
          if (!session.key.startsWith('agent:')) continue;
          const parts = session.key.split(':');
          if (parts.length < 3) continue;
          const suffix = parts.slice(2).join(':');
          if (suffix && !canonicalBySuffix.has(suffix)) {
            canonicalBySuffix.set(suffix, session.key);
          }
        }

        // Deduplicate: if both short and canonical existed, keep canonical only
        const seen = new Set<string>();
        const dedupedSessions = sessions.filter((s) => {
          if (!s.key.startsWith('agent:') && canonicalBySuffix.has(s.key)) return false;
          if (seen.has(s.key)) return false;
          seen.add(s.key);
          return true;
        });

        const {
          currentSessionKey,
          sessions: localSessions,
          pendingLocalSessionKeys,
          sessionLastActivity,
          sessionLabels,
        } = get();
        const hydratedSessionLabels = dedupedSessions.reduce<Record<string, string>>((acc, session) => {
          const nextLabel = resolveSessionSidebarTitle(session);
          if (nextLabel) {
            acc[session.key] = nextLabel;
          }
          return acc;
        }, { ...sessionLabels });
        const hydratedSessionLastActivity = dedupedSessions.reduce<Record<string, number>>(
          (acc, session) => {
            if (!acc[session.key] && session.updatedAt) {
              acc[session.key] = session.updatedAt;
            }
            return acc;
          },
          { ...sessionLastActivity }
        );
        const materializedSessionKeyMap = new Map<string, string>();
        for (const pendingKey of Object.keys(pendingLocalSessionKeys)) {
          if (realSessionKeys.has(pendingKey)) continue;
          const materializedKey = findMaterializedSessionKey({
            pendingKey,
            pendingLabel: hydratedSessionLabels[pendingKey],
            pendingActivityMs: hydratedSessionLastActivity[pendingKey],
            sessions: dedupedSessions,
            sessionLabels: hydratedSessionLabels,
            sessionLastActivity: hydratedSessionLastActivity,
          });
          if (!materializedKey) continue;
          materializedSessionKeyMap.set(pendingKey, materializedKey);
          if (!hydratedSessionLabels[materializedKey] && hydratedSessionLabels[pendingKey]) {
            hydratedSessionLabels[materializedKey] = hydratedSessionLabels[pendingKey];
          }
          if (!hydratedSessionLastActivity[materializedKey] && hydratedSessionLastActivity[pendingKey]) {
            hydratedSessionLastActivity[materializedKey] = hydratedSessionLastActivity[pendingKey];
          }
          delete hydratedSessionLabels[pendingKey];
          delete hydratedSessionLastActivity[pendingKey];
        }
        let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
        nextSessionKey = materializedSessionKeyMap.get(nextSessionKey) || nextSessionKey;
        if (!nextSessionKey.startsWith('agent:')) {
          const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
          if (canonicalMatch) {
            nextSessionKey = canonicalMatch;
          }
        }
        const hasLocalPendingSession =
          Boolean(pendingLocalSessionKeys[nextSessionKey]) &&
          localSessions.some((session) => session.key === nextSessionKey) &&
          !realSessionKeys.has(nextSessionKey);
        const preferredSessionKey = getMostRecentSessionKey(
          dedupedSessions,
          hydratedSessionLastActivity
        );
        const currentSessionMissing = !dedupedSessions.some((session) => session.key === nextSessionKey);
        const shouldAutoChooseLatest =
          !preserveCurrent && !hasLocalPendingSession && (preferMostRecent || currentSessionMissing);

        if (!dedupedSessions.find((s) => s.key === nextSessionKey) && dedupedSessions.length > 0) {
          // Preserve locally-created synthetic sessions until they materialize
          // in Gateway. Otherwise background refresh can snap the UI back to an
          // older real session right after the user clicks "New chat".
          if (!hasLocalPendingSession) {
            if (preserveCurrent) {
              const agentsState = getAppliedAgentsSnapshotState();
              const fallbackAgentId =
                getAgentIdFromSessionKey(nextSessionKey)
                || get().currentAgentId
                || agentsState.defaultAgentId
                || 'main';
              const fallbackMainSessionKey = buildAgentMainSessionKey(
                fallbackAgentId,
                agentsState.mainKey,
              );
              nextSessionKey = dedupedSessions.find((session) => session.key === fallbackMainSessionKey)?.key
                || preferredSessionKey
                || dedupedSessions[0].key;
            } else {
              nextSessionKey = preferredSessionKey || dedupedSessions[0].key;
            }
          }
        } else if (shouldAutoChooseLatest && preferredSessionKey) {
          nextSessionKey = preferredSessionKey;
        }

        const shouldKeepSyntheticCurrent = hasLocalPendingSession || dedupedSessions.length === 0;
        const sessionsWithCurrent =
          !dedupedSessions.find((s) => s.key === nextSessionKey) &&
          nextSessionKey &&
          shouldKeepSyntheticCurrent
            ? [...dedupedSessions, { key: nextSessionKey, displayName: nextSessionKey }]
            : dedupedSessions;

        const nextPendingLocalSessionKeys = Object.fromEntries(
          Object.entries(pendingLocalSessionKeys).filter(([key]) => (
            !realSessionKeys.has(key) && !materializedSessionKeyMap.has(key)
          ))
        ) as Record<string, true>;

        set((state) => ({
          sessions: sessionsWithCurrent,
          sessionsLoading: silent ? state.sessionsLoading : false,
          sessionsLoadingMore: false,
          sessionsHydrated: true,
          sessionsHasMore: data.hasMore === true,
          sessionsNextCursor: typeof data.nextCursor === 'string' && data.nextCursor.trim() ? data.nextCursor : null,
          currentSessionKey: nextSessionKey,
          currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
          pendingLocalSessionKeys: nextPendingLocalSessionKeys,
          historyWindowLimited: false,
          hasEarlierHistory: false,
          loadingEarlierHistory: false,
          earlierHistoryCursor: null,
          sessionLabels: hydratedSessionLabels,
          sessionLastActivity: hydratedSessionLastActivity,
        }));
        persistCurrentSessionKey(nextSessionKey);

        const unresolvedTitleCount = sessionsWithCurrent.filter((session) => (
          realSessionKeys.has(session.key)
          && !pendingLocalSessionKeys[session.key]
          && !hasResolvableSessionTitle(session, hydratedSessionLabels)
        )).length;
        if (warmLabels && unresolvedTitleCount > 0) {
          if (
            !_sessionTitleRefreshTimer
            && _sessionTitleRefreshAttempts < SESSION_TITLE_REFRESH_MAX_ATTEMPTS
          ) {
            _sessionTitleRefreshTimer = setTimeout(() => {
              _sessionTitleRefreshTimer = null;
              if (useGatewayStore.getState().status.state !== 'running') return;
              _sessionTitleRefreshAttempts += 1;
              void get().loadSessions({ preserveCurrent: true, warmLabels: true, silent: true });
            }, SESSION_TITLE_REFRESH_DELAY_MS);
          }
        } else {
          clearSessionTitleRefreshRetry(true);
        }

      }
    } catch (err) {
      console.warn('Failed to load sessions:', err);
      set((state) => ({
        sessionsLoading: silent ? state.sessionsLoading : false,
        sessionsLoadingMore: false,
        sessionsHydrated: silent ? state.sessionsHydrated : false,
      }));
    }
  },

  loadMoreSessions: async () => {
    const { sessionsLoading, sessionsLoadingMore, sessionsHasMore, sessionsNextCursor } = get();
    if (sessionsLoading || sessionsLoadingMore || !sessionsHasMore || !sessionsNextCursor) {
      return;
    }

    set({ sessionsLoadingMore: true });

    try {
      const data = await Promise.race([
        hostApiFetch<SessionListResponse>('/api/sessions/list', {
          method: 'POST',
          body: JSON.stringify({
            limit: SESSION_LIST_PAGE_LIMIT,
            cursor: sessionsNextCursor,
          }),
        }),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('sessions.list timed out')), SESSIONS_LIST_TIMEOUT_MS)
        ),
      ]);

      const pageSessions = normalizeSessionListResponse(data);
      const state = get();
      const sessionLabels = { ...state.sessionLabels };
      const sessionLastActivity = { ...state.sessionLastActivity };
      const mergedSessions = [...state.sessions];

      for (const session of pageSessions) {
        const existingIndex = mergedSessions.findIndex((existing) => existing.key === session.key);
        if (existingIndex >= 0) {
          mergedSessions[existingIndex] = { ...mergedSessions[existingIndex], ...session };
        } else {
          mergedSessions.push(session);
        }

        const nextLabel = resolveSessionSidebarTitle(session);
        if (nextLabel) {
          sessionLabels[session.key] = nextLabel;
        }
        if (!sessionLastActivity[session.key] && session.updatedAt) {
          sessionLastActivity[session.key] = session.updatedAt;
        }
      }

      set({
        sessions: mergedSessions,
        sessionsLoadingMore: false,
        sessionsHasMore: data?.hasMore === true,
        sessionsNextCursor: typeof data?.nextCursor === 'string' && data.nextCursor.trim() ? data.nextCursor : null,
        sessionLabels,
        sessionLastActivity,
      });
    } catch (err) {
      console.warn('Failed to load more sessions:', err);
      set({ sessionsLoadingMore: false });
    }
  },

  restoreSessionsAfterGatewayReady: async () => {
    if (_sessionRestorePromise) {
      await _sessionRestorePromise;
      return;
    }

    _sessionRestorePromise = (async () => {
      // Early exit: gateway must still be running when we actually start.
      // This prevents a stale restore attempt from running after the gateway
      // has gone down (e.g. a deferred restart fired just before a real restart).
      if (useGatewayStore.getState().status.state !== 'running') {
        return;
      }

      // Safety timeout: if everything hangs, give up after RESTORE_SAFETY_TIMEOUT_MS
      // so the retry path gets unblocked and the UI can show a useful state.
      let safetyTimedOut = false;
      const safetyTimer = setTimeout(() => {
        safetyTimedOut = true;
        // Mark sessions as not hydrated so scheduleRetry will fire a retry.
        // Also clear loading flags so the UI is not stuck.
        set({ sessionsLoading: false, loading: false, sessionsHydrated: false });
      }, RESTORE_SAFETY_TIMEOUT_MS);

      let attempt = 0;

      try {
        while (true) {
          attempt++;
          if (safetyTimedOut) break;

          // Check gateway is still running before each attempt.
          if (useGatewayStore.getState().status.state !== 'running') break;

          try {
            // ── Step 1: Load session list (with per-attempt timeout) ────────
            const sessionsOk = await Promise.race([
              get().loadSessions({ preserveCurrent: true, warmLabels: true }),
              new Promise<false>((_, reject) =>
                setTimeout(() => reject(new Error('sessions.list timeout')), SESSIONS_LIST_TIMEOUT_MS * 2)
              ),
            ]).then(() => true).catch(() => false);

            if (!sessionsOk || safetyTimedOut) {
              scheduleRetry(attempt);
              break;
            }

            // sessionsHydrated is now true if loadSessions succeeded.
            // ── Step 2: Load history for current session ───────────────────────
            // (warm-label fetching already runs in parallel inside loadSessions).
            // If history times out, sessions are still shown — scheduleRetry
            // will continue retrying history in the background.
            await Promise.race([
              get().loadHistory(get().messages.length > 0),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('chat.history timeout')), HISTORY_LOAD_TIMEOUT_MS)
              ),
            ]).catch(() => { /* timeout → scheduleRetry will retry */ });

            if (shouldRetryInitialHistory(get())) {
              scheduleInitialHistoryRetry();
            } else {
              clearInitialHistoryRefreshRetry(true);
            }

            clearSessionRestoreRetry();
            break; // success or partial — either way we're done here
          } catch {
            scheduleRetry(attempt);
            break;
          }
        }
      } finally {
        clearTimeout(safetyTimer);
        _sessionRestorePromise = null;
      }

      function scheduleRetry(currentAttempt: number): void {
        if (useGatewayStore.getState().status.state !== 'running') return;
        // Partial success: if we have sessions (even without history), stop retrying.
        if (get().sessionsHydrated && get().messages.length > 0) return;

        clearSessionRestoreRetry();
        // Exponential backoff: 1s, 2s, 4s, 8s … capped at MAX_DELAY.
        const delay = Math.min(
          SESSION_RESTORE_INITIAL_DELAY_MS * Math.pow(2, currentAttempt - 1),
          SESSION_RESTORE_MAX_DELAY_MS
        );
        _sessionRestoreRetryTimer = setTimeout(() => {
          _sessionRestoreRetryTimer = null;
          if (
            useGatewayStore.getState().status.state === 'running'
            && (!get().sessionsHydrated || get().messages.length === 0)
          ) {
            void get().restoreSessionsAfterGatewayReady();
          }
        }, delay);
      }

      function scheduleInitialHistoryRetry(): void {
        if (_initialHistoryRefreshTimer) return;
        if (_initialHistoryRefreshAttempts >= INITIAL_HISTORY_REFRESH_MAX_ATTEMPTS) return;

        _initialHistoryRefreshTimer = setTimeout(() => {
          _initialHistoryRefreshTimer = null;
          if (!shouldRetryInitialHistory(get())) {
            clearInitialHistoryRefreshRetry(true);
            return;
          }

          _initialHistoryRefreshAttempts += 1;
          void get().loadHistory(true).finally(() => {
            if (shouldRetryInitialHistory(get())) {
              scheduleInitialHistoryRetry();
            } else {
              clearInitialHistoryRefreshRetry(true);
            }
          });
        }, INITIAL_HISTORY_REFRESH_DELAY_MS);
      }
    })();

    await _sessionRestorePromise;
  },

  // ── Switch session ──

  switchSession: (key: string) => {
    const {
      currentSessionKey,
      messages,
      pendingLocalSessionKeys,
      pendingUserMessage,
      pendingAssistantMessage,
    } = get();
    const leavingEmpty =
      !currentSessionKey.endsWith(':main')
      && isEmptyEphemeralSession(
        currentSessionKey,
        messages,
        pendingLocalSessionKeys,
        pendingUserMessage,
        pendingAssistantMessage,
      );
    set((s) => ({
      currentSessionKey: key,
      currentAgentId: getAgentIdFromSessionKey(key),
      messages: [],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      btwMessages: [],
      historyWindowLimited: false,
      hasEarlierHistory: false,
      loadingEarlierHistory: false,
      earlierHistoryCursor: null,
      sending: false,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      activeRunId: null,
      error: null,
      pendingFinal: false,
      terminalHistoryReconciling: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      ...resetToolStreamState(s),
      ...(leavingEmpty
        ? removeSessionArtifacts(s, currentSessionKey)
        : {}),
    }));
    persistCurrentSessionKey(key);
    get().loadHistory();
  },

  // ── Delete session ──
  //
  // Session deletion goes through the host API proxy, which calls the Gateway's
  // sessions.delete RPC and removes the corresponding transcript on disk.

  deleteSession: async (key: string) => {
    if (isMainSessionKey(key)) {
      set({ error: 'Main sessions cannot be deleted.' });
      return;
    }

    // Soft-delete the session's JSONL transcript on disk.
    // The main process renames <suffix>.jsonl → <suffix>.deleted.jsonl so that
    // sessions.list skips it automatically.
    try {
      const result = await hostApiFetch<{
        success: boolean;
        error?: string;
      }>('/api/sessions/delete', {
        method: 'POST',
        body: JSON.stringify({ sessionKey: key }),
      });
      if (!result.success) {
        console.warn(`[deleteSession] IPC reported failure for ${key}:`, result.error);
      }
    } catch (err) {
      console.warn(`[deleteSession] IPC call failed for ${key}:`, err);
    }

    const { currentSessionKey, sessions } = get();
    const remaining = sessions.filter((s) => s.key !== key);

    if (currentSessionKey === key) {
      // Switched away from deleted session — pick the first remaining or create new
      const next = remaining[0];
      set((s) => ({
        ...removeSessionArtifacts(s, key),
        messages: [],
        pendingUserMessage: null,
        pendingAssistantMessage: null,
        btwMessages: [],
        historyWindowLimited: false,
        hasEarlierHistory: false,
        loadingEarlierHistory: false,
        earlierHistoryCursor: null,
        sending: false,
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        activeRunId: null,
        error: null,
        pendingFinal: false,
        terminalHistoryReconciling: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
        ...resetToolStreamState(s),
        currentSessionKey: next?.key ?? DEFAULT_SESSION_KEY,
        currentAgentId: getAgentIdFromSessionKey(next?.key ?? DEFAULT_SESSION_KEY),
      }));
      persistCurrentSessionKey(next?.key ?? DEFAULT_SESSION_KEY);
      if (next) {
        get().loadHistory();
      }
    } else {
      set((s) => removeSessionArtifacts(s, key));
    }
  },

  // ── New session ──

  newSession: (targetAgentId) => {
    const {
      currentSessionKey,
      messages,
      pendingLocalSessionKeys,
      pendingUserMessage,
      pendingAssistantMessage,
    } = get();
    const nextAgentId = targetAgentId
      || get().currentAgentId
      || getAppliedAgentsSnapshotState().defaultAgentId
      || 'main';
    const isCurrentEmptyEphemeral =
      !currentSessionKey.endsWith(':main')
      && isEmptyEphemeralSession(
        currentSessionKey,
        messages,
        pendingLocalSessionKeys,
        pendingUserMessage,
        pendingAssistantMessage,
      );
    const prefix = `agent:${nextAgentId}`;
    const newKey = `${prefix}:session-${Date.now()}`;
    const newSessionEntry: ChatSession = { key: newKey, displayName: newKey };
    const nowMs = Date.now();
    set((s) => ({
      currentSessionKey: newKey,
      currentAgentId: nextAgentId,
      sessions: [
        ...(isCurrentEmptyEphemeral ? s.sessions.filter((session) => session.key !== currentSessionKey) : s.sessions),
        newSessionEntry,
      ],
      sessionLabels: isCurrentEmptyEphemeral
        ? omitSessionKey(s.sessionLabels, currentSessionKey)
        : s.sessionLabels,
      sessionLastActivity: { ...s.sessionLastActivity, [newKey]: nowMs },
      pendingLocalSessionKeys: {
        ...(isCurrentEmptyEphemeral
          ? omitSessionKey(s.pendingLocalSessionKeys, currentSessionKey)
          : s.pendingLocalSessionKeys),
        [newKey]: true,
      },
      messages: [],
      pendingUserMessage: null,
      pendingAssistantMessage: null,
      btwMessages: [],
      historyWindowLimited: false,
      hasEarlierHistory: false,
      loadingEarlierHistory: false,
      earlierHistoryCursor: null,
      sending: false,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      ...resetToolStreamState(s),
    }));
    persistCurrentSessionKey(newKey);
  },

  // ── Cleanup empty session on navigate away ──

  cleanupEmptySession: () => {
    const {
      currentSessionKey,
      messages,
      pendingLocalSessionKeys,
      pendingUserMessage,
      pendingAssistantMessage,
    } = get();
    // Only remove non-main sessions that were never used (no messages sent).
    // This mirrors the "leavingEmpty" logic in switchSession so that creating
    // a new session and immediately navigating away doesn't leave a ghost entry
    // in the sidebar.
    const isEmptyNonMain =
      !currentSessionKey.endsWith(':main')
      && isEmptyEphemeralSession(
        currentSessionKey,
        messages,
        pendingLocalSessionKeys,
        pendingUserMessage,
        pendingAssistantMessage,
      );
    if (!isEmptyNonMain) return;
    set((s) => removeSessionArtifacts(s, currentSessionKey));
  },

  setSessionModel: async (model) => {
    const { currentSessionKey, allowedModelRefs, defaultModelRef, sessions } = get();
    const trimmedModel = model?.trim() || undefined;
    const hasGuard = allowedModelRefs.length > 0;
    const resolvedDefaultModel =
      (defaultModelRef && (!hasGuard || allowedModelRefs.includes(defaultModelRef)))
        ? defaultModelRef
        : allowedModelRefs[0];
    const modelForPatch = trimmedModel ?? resolvedDefaultModel ?? 'default';

    if (hasGuard && !allowedModelRefs.includes(modelForPatch)) {
      const message = `Model is not available in current runtime: ${modelForPatch}`;
      set({ error: message });
      throw new Error(message);
    }

    try {
      const currentSession = sessions.find((session) => session.key === currentSessionKey);
      const currentSessionRef = resolveSessionModelRef(currentSession, allowedModelRefs);
      const splitIndex = modelForPatch.indexOf('/');
      const targetProvider = splitIndex > 0 ? modelForPatch.slice(0, splitIndex) : undefined;
      const targetModelId = splitIndex > 0 ? modelForPatch.slice(splitIndex + 1) : modelForPatch;
      const currentProvider = currentSessionRef?.includes('/')
        ? currentSessionRef.slice(0, currentSessionRef.indexOf('/'))
        : currentSession?.modelProvider;
      const isCrossProvider = Boolean(targetProvider && currentProvider && targetProvider !== currentProvider);
      const patchOnce = async (value: string) => {
        return await useGatewayStore.getState().rpc<{
          entry?: Record<string, unknown>;
          resolved?: { modelProvider?: string; model?: string };
        }>('sessions.patch', {
          key: currentSessionKey,
          model: value,
        });
      };
      const providerCandidates = targetProvider
        ? allowedModelRefs.filter((ref) => ref.startsWith(`${targetProvider}/`))
        : [];
      const providerDefaultRef = providerCandidates.find((ref) => ref === defaultModelRef) || providerCandidates[0];
      const providerDefaultId = providerDefaultRef?.split('/').slice(1).join('/');
      const attempts = new Set<string>();
      const queueAttempt = (value: string | undefined) => {
        const trimmed = value?.trim();
        if (!trimmed) return;
        attempts.add(trimmed);
      };

      if (targetProvider) {
        queueAttempt(modelForPatch);
      } else {
        queueAttempt(modelForPatch);
        queueAttempt(targetModelId);
      }

      if (isCrossProvider) {
        queueAttempt(providerDefaultRef);
        queueAttempt(providerDefaultId);
        queueAttempt(modelForPatch);
      }

      let lastError: unknown = null;
      let patched = false;
      let resolvedSelection:
        | { model?: string; modelProvider?: string }
        | undefined;
      for (const candidate of attempts) {
        try {
          const result = await patchOnce(candidate);
          resolvedSelection = result?.resolved;
          patched = true;
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!/model not allowed/i.test(message)) {
            throw err;
          }
          lastError = err;
        }
      }
      if (!patched && lastError) {
        throw lastError;
      }

      set((s) => ({
        sessions: s.sessions.map((session) => (
          session.key === currentSessionKey
            ? {
              ...session,
              model: resolvedSelection?.model
                ?? ((trimmedModel ?? modelForPatch).includes('/')
                  ? (trimmedModel ?? modelForPatch).split('/').slice(1).join('/')
                  : (trimmedModel ?? modelForPatch)),
              modelProvider: resolvedSelection?.modelProvider ?? targetProvider ?? session.modelProvider,
            }
            : session
        )),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
      throw err;
    }
  },

  // ── Load chat history ──

  loadHistory: async (quiet = false) => {
    const { currentSessionKey, pendingLocalSessionKeys } = get();
    const requestSessionKey = currentSessionKey;
    const requestSeq = ++_historyLoadSeq;
    const isStale = () =>
      get().currentSessionKey !== requestSessionKey || requestSeq !== _historyLoadSeq;
    const clearLoadingIfLatest = () => {
      if (!quiet && requestSeq === _historyLoadSeq) {
        set({ loading: false });
      }
    };
    if (!quiet) set({ loading: true, error: null });

    // Brand-new local sessions do not exist in Gateway yet. Querying chat.history
    // for them can fall back to an older real transcript, which makes "New chat"
    // appear to jump back into a previous conversation. Keep them empty until the
    // first user message materializes the session in Gateway.
    if (isEmptyEphemeralSession(
      requestSessionKey,
      get().messages,
      pendingLocalSessionKeys,
      get().pendingUserMessage,
      get().pendingAssistantMessage,
    )) {
      set({
        ...(quiet ? {} : { loading: false }),
        error: null,
        messages: [],
        pendingUserMessage: null,
        pendingAssistantMessage: null,
        btwMessages: [],
        historyWindowLimited: false,
        hasEarlierHistory: false,
        loadingEarlierHistory: false,
        earlierHistoryCursor: null,
      });
      return;
    }

    try {
      const startedAt = Date.now();
      const requestHistory = async (): Promise<SessionHistoryResponse> => {
        for (;;) {
          try {
            return await Promise.race([
              hostApiFetch<SessionHistoryResponse>('/api/sessions/history', {
                method: 'POST',
                body: JSON.stringify({
                  sessionKey: requestSessionKey,
                  limit: CHAT_HISTORY_PAGE_LIMIT,
                }),
                timeoutMs: HISTORY_LOAD_TIMEOUT_MS,
              }),
              new Promise<SessionHistoryResponse>((_, reject) =>
                setTimeout(() => reject(new Error('session history timed out')), HISTORY_LOAD_TIMEOUT_MS)
              ),
            ]);
          } catch (err) {
            const withinStartupRetryWindow =
              Date.now() - startedAt < STARTUP_CHAT_HISTORY_RETRY_TIMEOUT_MS;
            if (
              !isStale()
              && withinStartupRetryWindow
              && isRetryableStartupHistoryError(err)
            ) {
              await sleep(resolveStartupRetryDelayMs(err));
              continue;
            }
            throw err;
          }
        }
      };
      // Timeout guard: prevents indefinite hang if Gateway is degraded.
      const data = await requestHistory();
      if (isStale()) {
        clearLoadingIfLatest();
        return;
      }
      if (data) {
        const rawMessages = (Array.isArray(data.messages) ? (data.messages as RawMessage[]) : [])
          .filter((message) => !isInternalHistoryMessage(message));
        const stateBeforeCommit = get();
        const hasExistingAuthoritativeMessages = stateBeforeCommit.messages.length > 0;

        const enrichedMessages = enrichWithCachedImages(rawMessages);

        // History poll is the fallback when Gateway streaming events are missing
        // (WS disconnect, console-only runs, etc.). Any assistant turn after the
        // user's message counts as progress so the safety timeout does not emit a
        // false "No response received" error while tool chains are still running.
        const isSendingNow = stateBeforeCommit.sending;
        const latestTerminalAssistantErrorMessage = isTerminalAssistantErrorMessage(enrichedMessages[enrichedMessages.length - 1])
          ? enrichedMessages[enrichedMessages.length - 1]
          : null;
        if (latestTerminalAssistantErrorMessage) {
          clearHistoryPoll();
          set({
            sending: false,
            activeRunId: null,
            pendingFinal: false,
            lastUserMessageAt: null,
          });
        }

        if (isSendingNow && hasMeaningfulAssistantProgressAfterLastUser(enrichedMessages)) {
          _lastChatEventAt = Date.now();
          if (get().error) {
            set({ error: null });
          }
        }

        if (isSendingNow && !stateBeforeCommit.pendingFinal) {
          const pendingUserTs = stateBeforeCommit.lastUserMessageAt ? toMs(stateBeforeCommit.lastUserMessageAt) : 0;
          const hasFinalLikeAssistant = [...enrichedMessages].reverse().find((msg) => {
            if (msg.role !== 'assistant') return false;
            if (pendingUserTs && msg.timestamp && toMs(msg.timestamp) < pendingUserTs) return false;
            if (hasPendingToolUse(msg)) return false;
            return hasNonToolAssistantContent(msg);
          });
          if (hasFinalLikeAssistant) {
            set({ pendingFinal: true });
          }
        }

        // Keep transcript ordering as close to Gateway history as possible.
        // Only enrich cached file/image previews for display.

        if (rawMessages.length === 0 && hasExistingAuthoritativeMessages) {
          set({
            loading: false,
            loadingEarlierHistory: false,
          });
          return;
        }

        const fallbackThinkingLevel = stateBeforeCommit.sessions.find(
          (session) => session.key === requestSessionKey,
        )?.thinkingLevel ?? stateBeforeCommit.thinkingLevel ?? null;
        const thinkingLevel =
          typeof data.thinkingLevel === 'string'
            ? data.thinkingLevel
            : fallbackThinkingLevel;

        // Preserve the optimistic user message during an active send.
        // The Gateway may not include the user's message in chat.history
        // until the run completes, causing it to flash out of the UI.
        const pendingUserMessage = get().pendingUserMessage;
        const pendingAssistantMessage = get().pendingAssistantMessage;
        const finalMessages = enrichedMessages;
        const hasEquivalentAuthoritativeUserMessage = authoritativeHistoryContainsPendingUser(
          enrichedMessages,
          pendingUserMessage,
          get().lastUserMessageAt,
        );
        const hasEquivalentAuthoritativeAssistantMessage = authoritativeHistoryContainsPendingAssistant(
          enrichedMessages,
          pendingAssistantMessage,
          get().lastUserMessageAt,
        );

        // Derive a sidebar title from the first user message when the session
        // entry itself still lacks a usable title. This includes main sessions,
        // which can be visible before Gateway-side derived titles finish loading.
        // Guard: never overwrite a label the user has explicitly set or that is
        // already populated (e.g. from a prior loadHistory call).
        const labelText = findSessionTitleCandidate(finalMessages);
        if (labelText) {
          const truncated = labelText.length > 50 ? `${labelText.slice(0, 50)}…` : labelText;
          set((s) => {
            if (s.sessionLabels[requestSessionKey]) return {};
            return { sessionLabels: { ...s.sessionLabels, [requestSessionKey]: truncated } };
          });
        }

        // Record last activity time from the last message in history.
        // Only bump forward — never downgrade. The gateway's session-row
        // `updatedAt` is persisted slightly after the message's own timestamp,
        // so a blind overwrite here would demote the session in the sidebar
        // ordering every time the user clicks it.
        const lastMsg = finalMessages[finalMessages.length - 1];
        if (lastMsg?.timestamp) {
          const lastAt = toMs(lastMsg.timestamp);
          if (lastAt > 0) {
            set((s) => {
              const current = s.sessionLastActivity[requestSessionKey] ?? 0;
              if (lastAt <= current) return {};
              return {
                sessionLastActivity: { ...s.sessionLastActivity, [requestSessionKey]: lastAt },
              };
            });
          }
        }

        // Async: load missing image previews from disk (updates in background)
        loadMissingPreviews(finalMessages).then((updated) => {
          if (isStale()) return;
          if (updated) {
            // Create new object references so React.memo detects changes.
            // loadMissingPreviews mutates AttachedFileMeta in place, so we
            // must produce fresh message + file references for each affected msg.
            set({
              messages: finalMessages.map((msg) =>
                msg._attachedFiles
                  ? { ...msg, _attachedFiles: msg._attachedFiles.map((f) => ({ ...f })) }
                  : msg
              ),
            });
          }
        });
        const { pendingFinal, lastUserMessageAt } = stateBeforeCommit;
        if (isStale()) {
          clearLoadingIfLatest();
          return;
        }

        const userMsTs = lastUserMessageAt ? toMs(lastUserMessageAt) : 0;
        const isAfterUserMsg = (msg: RawMessage): boolean => {
          if (!userMsTs || !msg.timestamp) return true;
          return toMs(msg.timestamp) >= userMsTs;
        };

        const shouldResetLiveState = !stateBeforeCommit.sending;
        set((s) => ({
          messages: finalMessages,
          pendingUserMessage: hasEquivalentAuthoritativeUserMessage ? null : s.pendingUserMessage,
          pendingAssistantMessage: hasEquivalentAuthoritativeAssistantMessage ? null : s.pendingAssistantMessage,
          btwMessages: [],
          thinkingLevel,
          historyWindowLimited: data.hasMore === true,
          hasEarlierHistory: data.hasMore === true,
          loadingEarlierHistory: false,
          earlierHistoryCursor:
            typeof data.nextCursor === 'string' && data.nextCursor.trim()
              ? data.nextCursor
              : null,
          loading: false,
          ...(shouldResetLiveState ? resetToolStreamState(s) : {}),
          ...(shouldResetLiveState ? { streamingText: '', streamingMessage: null, streamingTools: [] as ToolStatus[] } : {}),
        }));

        // CRITICAL: reject intermediate tool turns so the run stays "open" across
        // all tool rounds. Without `hasPendingToolUse` the closer matches the first
        // `[thinking, toolCall]` intermediate turn, clears `sending`/`activeRunId`/
        // `pendingFinal`, and makes the Thinking… indicator vanish mid-chain.
        if (pendingFinal || get().pendingFinal) {
          const recentAssistant = [...enrichedMessages].reverse().find((msg) => {
            if (msg.role !== 'assistant') return false;
            if (!isAfterUserMsg(msg)) return false;
            if (hasPendingToolUse(msg)) return false;
            return hasNonToolAssistantContent(msg);
          });
          if (recentAssistant) {
            clearHistoryPoll();
            set((s) => ({
              sending: false,
              activeRunId: null,
              pendingFinal: false,
              pendingAssistantMessage: hasEquivalentAuthoritativeAssistantMessage ? null : s.pendingAssistantMessage,
              ...resetToolStreamState(s),
              streamingText: '',
              streamingMessage: null,
              streamingTools: [],
            }));
          }
        }

        // Unstick lifecycle when history already has a conclusive reply but the
        // Gateway never emitted a terminal phase event (WS drop, console run, etc.).
        if (isSendingNow && !get().streamingMessage && get().streamingTools.length === 0) {
          const openSegment = postUserSegmentMessages(enrichedMessages);
          const hasConclusiveReply = openSegment.some((message) => {
            if (message.role !== 'assistant') return false;
            if (hasPendingToolUse(message)) return false;
            return hasNonToolAssistantContent(message);
          });
          if (hasConclusiveReply && !segmentHasOpenToolRun(openSegment)) {
            clearHistoryPoll();
            set({
              sending: false,
              activeRunId: null,
              pendingFinal: false,
              lastUserMessageAt: null,
            });
          }
        }

        // After session switch the renderer may have reset run lifecycle flags even
        // though the Gateway is still executing a user-initiated turn. Re-arm only
        // when this session had an active cached run (e.g. user switched away
        // mid-send). Do not re-arm from stale :main heartbeat/tool history alone.
        if (!get().sending && !latestTerminalAssistantErrorMessage && hasCachedActiveUserRun(requestSessionKey)) {
          const openSegment = postUserSegmentMessages(enrichedMessages);
          if (segmentHasOpenToolRun(openSegment)) {
            set((s) => ({
              sending: true,
              activeRunId: s.activeRunId || `re-arm:${Date.now()}`,
            }));
          }
        }
      } else {
        if (isStale()) {
          clearLoadingIfLatest();
          return;
        }
        set((state) => ({
          loading: false,
          loadingEarlierHistory: false,
          ...(state.messages.length === 0 && !state.pendingUserMessage && !state.pendingAssistantMessage
            ? {
                messages: [],
                pendingUserMessage: null,
                pendingAssistantMessage: null,
                btwMessages: [],
                historyWindowLimited: false,
                hasEarlierHistory: false,
                earlierHistoryCursor: null,
              }
            : {}),
        }));
      }
    } catch (err) {
      if (isStale()) {
        clearLoadingIfLatest();
        return;
      }
      console.warn('Failed to load chat history:', err);
      set((state) => ({
        loading: false,
        loadingEarlierHistory: false,
        ...(state.messages.length === 0 && !state.pendingUserMessage && !state.pendingAssistantMessage
          ? {
              messages: [],
              pendingUserMessage: null,
              pendingAssistantMessage: null,
              btwMessages: [],
              historyWindowLimited: false,
              hasEarlierHistory: false,
              earlierHistoryCursor: null,
            }
          : {}),
      }));
    }
  },

  loadEarlierHistory: async () => {
    const {
      currentSessionKey,
      messages,
      pendingLocalSessionKeys,
      pendingUserMessage,
      pendingAssistantMessage,
      loadingEarlierHistory,
      hasEarlierHistory,
      earlierHistoryCursor,
    } = get();

    if (loadingEarlierHistory || !hasEarlierHistory) {
      return;
    }

    if (isEmptyEphemeralSession(
      currentSessionKey,
      messages,
      pendingLocalSessionKeys,
      pendingUserMessage,
      pendingAssistantMessage,
    )) {
      set({ hasEarlierHistory: false, loadingEarlierHistory: false, earlierHistoryCursor: null });
      return;
    }

    if (!earlierHistoryCursor) {
      set({ hasEarlierHistory: false, loadingEarlierHistory: false, earlierHistoryCursor: null });
      return;
    }

    set({ loadingEarlierHistory: true, error: null });

    try {
      const data = await hostApiFetch<SessionHistoryResponse>('/api/sessions/history', {
        method: 'POST',
        body: JSON.stringify({
          sessionKey: currentSessionKey,
          limit: CHAT_HISTORY_PAGE_LIMIT,
          cursor: earlierHistoryCursor,
        }),
      });

      const currentSessionStillActive = get().currentSessionKey === currentSessionKey;
      if (!currentSessionStillActive) {
        return;
      }

      const rawMessages = (Array.isArray(data.messages) ? data.messages : [])
        .filter((message) => !isInternalHistoryMessage(message));
      const enrichedMessages = enrichWithCachedImages(rawMessages);

      let prependedAny = false;
      let olderMessagesForPreview: RawMessage[] = [];
      set((state) => {
        const seenKeys = new Set(state.messages.map((message) => getRawMessageKey(message)));
        const uniqueOlderMessages = enrichedMessages.filter((message) => {
          const key = getRawMessageKey(message);
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });
        prependedAny = uniqueOlderMessages.length > 0;
        olderMessagesForPreview = uniqueOlderMessages;
        return {
          messages: prependedAny ? [...uniqueOlderMessages, ...state.messages] : state.messages,
          hasEarlierHistory: data.hasMore === true,
          historyWindowLimited: data.hasMore === true,
          loadingEarlierHistory: false,
          earlierHistoryCursor:
            typeof data.nextCursor === 'string' && data.nextCursor.trim()
              ? data.nextCursor
              : null,
        };
      });

      if (prependedAny) {
        void loadMissingPreviews(olderMessagesForPreview).then((updated) => {
          if (!updated || get().currentSessionKey !== currentSessionKey) return;
          set((state) => ({
            messages: state.messages.map((message) =>
              message._attachedFiles
                ? { ...message, _attachedFiles: message._attachedFiles.map((file) => ({ ...file })) }
                : message
            ),
          }));
        });
      }
    } catch (err) {
      if (get().currentSessionKey !== currentSessionKey) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, loadingEarlierHistory: false });
    }
  },

  // ── Send message ──

  sendMessage: async (
    text: string,
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      fileSize: number;
      stagedPath: string;
      preview: string | null;
    }>
  ) => {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;

    const { currentSessionKey, sessions, allowedModelRefs, defaultModelRef, currentAgentId } = get();
    const currentSession = sessions.find((session) => session.key === currentSessionKey);
    const currentAgent = getAppliedAgentsSnapshotState().agents.find((agent) => agent.gateway.id === currentAgentId);
    const normalizedAgentModelRef = currentAgent?.local.modelRef?.trim();
    const agentModelAllowed =
      !normalizedAgentModelRef
      || allowedModelRefs.length === 0
      || allowedModelRefs.includes(normalizedAgentModelRef);
    const shouldApplyAgentModel =
      !currentSession?.model?.trim()
      && Boolean(normalizedAgentModelRef)
      && currentAgent?.local.inheritedModel !== true
      && agentModelAllowed;

    if (shouldApplyAgentModel && normalizedAgentModelRef) {
      try {
        await get().setSessionModel(normalizedAgentModelRef);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({
          error: `Failed to initialize session model for agent ${currentAgent?.gateway.id ?? currentAgentId}: ${message}`,
        });
        return;
      }
    }

    const refreshedSession = get().sessions.find((session) => session.key === currentSessionKey);
    const currentSessionModel = resolveSessionModelRef(refreshedSession, allowedModelRefs);
    const hasGuard = allowedModelRefs.length > 0;
    const sessionModelInvalid = hasGuard
      && typeof currentSessionModel === 'string'
      && !allowedModelRefs.includes(currentSessionModel);

    if (sessionModelInvalid) {
      const fallbackModel = defaultModelRef || allowedModelRefs[0];
      if (fallbackModel) {
        try {
          await get().setSessionModel(fallbackModel);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set({
            error: `Current session model is unavailable, and switching to ${fallbackModel} failed: ${message}`,
          });
          return;
        }
      } else {
        set({
          error: 'Current session model is unavailable. Configure or choose another model before sending.',
        });
        return;
      }
    }

    const sessionThinkingLevel = refreshedSession?.thinkingLevel?.trim();
    if (sessionThinkingLevel) {
      try {
        await useGatewayStore.getState().rpc<Record<string, unknown>>('sessions.patch', {
          key: currentSessionKey,
          thinkingLevel: sessionThinkingLevel,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({
          error: `Failed to initialize session thinking level: ${message}`,
        });
        return;
      }
    }

    const runId = crypto.randomUUID();
    const idempotencyKey = runId;

    // Add user message optimistically (with local file metadata for UI display)
    const nowMs = Date.now();
    const userMsg: RawMessage = {
      role: 'user',
      content: trimmed || (attachments?.length ? '(file attached)' : ''),
      timestamp: nowMs / 1000,
      id: crypto.randomUUID(),
      idempotencyKey,
      _attachedFiles: attachments?.map((a) => ({
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
        preview: a.preview,
        filePath: a.stagedPath,
      })),
    };
    set(() => ({
      pendingUserMessage: userMsg,
      pendingAssistantMessage: null,
      sending: true,
      activeRunId: runId,
      error: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      chatToolMessages: [],
      chatStreamSegments: [],
      pendingFinal: false,
      terminalHistoryReconciling: false,
      lastUserMessageAt: nowMs,
      pendingSessionModelRefresh: isSlashModelCommandText(trimmed),
      toolStreamById: new Map<string, ToolStreamEntry>(),
      toolStreamOrder: [],
    }));

    // Update session label with first user message text as soon as it's sent,
    // including main sessions before the Gateway derives a title.
    const { sessionLabels, messages } = get();
    const isFirstMessage = !messages.some((m) => m.role === 'user');
    if (
      isFirstMessage &&
      !sessionLabels[currentSessionKey] &&
      trimmed
    ) {
      const truncated = trimmed.length > 50 ? `${trimmed.slice(0, 50)}…` : trimmed;
      set((s) => ({ sessionLabels: { ...s.sessionLabels, [currentSessionKey]: truncated } }));
    }

    // Mark this session as most recently active
    set((s) => ({ sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: nowMs } }));

    // Match OpenClaw dashboard: live chat events own the active transcript.
    // Do not poll chat.history mid-run, because an incomplete authoritative
    // snapshot can erase optimistic user text and streaming assistant output.
    _lastChatEventAt = Date.now();
    clearHistoryPoll();

    const checkStuck = () => {
      const state = get();
      if (!state.sending) return;
      if (state.streamingMessage || state.streamingText) return;
      const idleMs = Date.now() - _lastChatEventAt;
      if (state.pendingFinal && idleMs < CHAT_RESPONSE_WATCHDOG_TIMEOUT_MS) {
        setTimeout(checkStuck, 10_000);
        return;
      }
      if (!state.pendingFinal && idleMs < CHAT_RESPONSE_WATCHDOG_TIMEOUT_MS) {
        setTimeout(checkStuck, 10_000);
        return;
      }
      clearHistoryPoll();
      void state.loadHistory(true);
      set({
        error:
          state.pendingFinal
            ? 'Response finalization timed out after the Gateway stopped sending updates. Refresh the conversation or restart the Gateway if it remains unavailable.'
            : 'The model did not produce a response before the waiting window expired. Please try again, or increase `agents.defaults.llm.idleTimeoutSeconds` in your OpenClaw config if the model is legitimately slow.',
        sending: false,
        activeRunId: null,
        pendingFinal: false,
        pendingSessionModelRefresh: false,
        pendingAssistantMessage: null,
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        pendingToolImages: [],
        lastUserMessageAt: null,
        ...resetToolStreamState(get()),
      });
    };
    setTimeout(checkStuck, 30_000);

    try {
      const hasMedia = attachments && attachments.length > 0;
      if (hasMedia && import.meta.env.DEV) {
        console.debug(
          '[sendMessage] Media paths:',
          attachments!.map((a) => a.stagedPath)
        );
      }

      // Cache image attachments BEFORE the IPC call to avoid race condition:
      // history may reload (via Gateway event) before the RPC returns.
      // Keyed by staged file path which appears in [media attached: <path> ...].
      if (hasMedia && attachments) {
        for (const a of attachments) {
          _imageCache.set(a.stagedPath, {
            fileName: a.fileName,
            mimeType: a.mimeType,
            fileSize: a.fileSize,
            preview: a.preview,
          });
        }
        saveImageCache(_imageCache);
      }

      let result: { success: boolean; result?: { runId?: string }; error?: string };

      const executeSend = async (idempotencyKey: string) => {
        if (hasMedia) {
          return await hostApiFetch<{
            success: boolean;
            result?: { runId?: string };
            error?: string;
          }>('/api/chat/send-with-media', {
            method: 'POST',
            timeoutMs: CHAT_SEND_TIMEOUT_MS + 5000,
            body: JSON.stringify({
              sessionKey: currentSessionKey,
              message: trimmed || 'Process the attached file(s).',
              deliver: false,
              idempotencyKey,
              media: attachments.map((a) => ({
                filePath: a.stagedPath,
                mimeType: a.mimeType,
                fileName: a.fileName,
              })),
            }),
          });
        }

        const rpcResult = await useGatewayStore.getState().rpc<{ runId?: string }>(
          'chat.send',
          {
            sessionKey: currentSessionKey,
            message: trimmed,
            deliver: false,
            idempotencyKey,
          },
          CHAT_SEND_TIMEOUT_MS
        );
        return { success: true, result: rpcResult } as { success: boolean; result?: { runId?: string }; error?: string };
      };

      result = await executeSend(idempotencyKey);

      const modelNotAllowed = !result.success && /model not allowed/i.test(result.error || '');
      if (modelNotAllowed) {
        const fallbackModel =
          (defaultModelRef && (!hasGuard || allowedModelRefs.includes(defaultModelRef)))
            ? defaultModelRef
            : allowedModelRefs[0] || 'default';
        try {
          const splitIndex = fallbackModel.indexOf('/');
          const providerOverride = splitIndex > 0 ? fallbackModel.slice(0, splitIndex) : undefined;
          const modelOverride = splitIndex > 0 ? fallbackModel.slice(splitIndex + 1) : fallbackModel;
          await useGatewayStore.getState().rpc<Record<string, unknown>>('sessions.patch', {
            key: currentSessionKey,
            model: fallbackModel,
          });

          set((s) => ({
            sessions: s.sessions.map((session) => (
              session.key === currentSessionKey
                ? {
                  ...session,
                  model: fallbackModel === 'default' ? undefined : modelOverride,
                  modelProvider: providerOverride ?? session.modelProvider,
                }
                : session
            )),
          }));

          result = await executeSend(idempotencyKey);
        } catch {
          // Keep the original error handling below if fallback patch/retry fails.
        }
      }

      if (import.meta.env.DEV) {
        console.debug(
          `[sendMessage] RPC result: success=${result.success}, localRunId=${runId}, gatewayRunId=${result.result?.runId || 'none'}`
        );
      }

      if (!result.success) {
        clearHistoryPoll();
        const errorMessage = result.error || 'Failed to send message';
        if (isGatewayDisconnectErrorMessage(errorMessage)) {
          set((s) => ({
            error: 'Gateway disconnected while sending. The message was kept locally; refresh after the Gateway recovers to verify whether it was delivered.',
            sending: false,
            activeRunId: null,
            pendingFinal: false,
            terminalHistoryReconciling: false,
            lastUserMessageAt: null,
            pendingAssistantMessage: null,
            ...resetToolStreamState(s),
          }));
        } else {
          set((s) => ({
            pendingUserMessage: s.pendingUserMessage?.id === userMsg.id ? null : s.pendingUserMessage,
            pendingAssistantMessage: null,
            error: errorMessage,
            sending: false,
            activeRunId: null,
            terminalHistoryReconciling: false,
            ...resetToolStreamState(s),
          }));
        }
      }
    } catch (err) {
      clearHistoryPoll();
      const errorMessage = String(err);
      if (isGatewayDisconnectErrorMessage(errorMessage)) {
        set((s) => ({
          error: 'Gateway disconnected while sending. The message was kept locally; refresh after the Gateway recovers to verify whether it was delivered.',
          sending: false,
          activeRunId: null,
          pendingFinal: false,
          terminalHistoryReconciling: false,
          lastUserMessageAt: null,
          pendingAssistantMessage: null,
          ...resetToolStreamState(s),
        }));
      } else {
        set((s) => ({
          pendingUserMessage: s.pendingUserMessage?.id === userMsg.id ? null : s.pendingUserMessage,
          pendingAssistantMessage: null,
          error: errorMessage,
          sending: false,
          activeRunId: null,
          terminalHistoryReconciling: false,
          ...resetToolStreamState(s),
        }));
      }
    }
  },

  // ── Abort active run ──

  abortRun: async () => {
    clearHistoryPoll();
    const { currentSessionKey } = get();
    set({
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      terminalHistoryReconciling: false,
      lastUserMessageAt: null,
      ...resetChatRuntimeActivity(get()),
    });

    try {
      await useGatewayStore.getState().rpc('chat.abort', { sessionKey: currentSessionKey });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  interruptActiveRunForPolicyChange: async (message: string) => {
    const { sending, activeRunId, currentSessionKey } = get();
    if (!sending && !activeRunId) {
      return false;
    }

    clearHistoryPoll();
    set({
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      terminalHistoryReconciling: false,
      lastUserMessageAt: null,
      error: message,
      ...resetChatRuntimeActivity(get()),
    });

    try {
      await useGatewayStore.getState().rpc('chat.abort', { sessionKey: currentSessionKey });
    } catch (err) {
      set({ error: `${message} (${String(err)})` });
    }

    return true;
  },

  // ── Handle incoming chat events from Gateway ──

  handleChatEvent: (event: Record<string, unknown>) => {
    const runId = String(event.runId || '');
    const eventState = String(event.state || '');
    const eventSessionKey = event.sessionKey != null ? String(event.sessionKey) : null;
    const { activeRunId, currentSessionKey, sessions } = get();

    // Treat canonical aliases as the same session (`main` <-> `agent:<id>:main`).
    // Also allow events from the active run even if their session key format differs
    // (e.g. BTW responses may use a different session key alias than the current session).
    const isActiveRun = Boolean(activeRunId && runId && runId === activeRunId);
    if (eventSessionKey != null && !sessionKeysMatch(currentSessionKey, eventSessionKey, sessions) && !isActiveRun) return;

    // Final from another run (e.g. sub-agent announce): refresh history to show new message.
    // See https://github.com/openclaw/openclaw/issues/1909
    if (activeRunId && runId && runId !== activeRunId) {
      if (eventState === 'final') {
        const finalMessage = event.message as RawMessage | undefined;
        if (
          finalMessage
          && !isAssistantSilentReply(finalMessage)
          && hasNonToolAssistantContent(finalMessage)
        ) {
          set((s) => {
            const id = finalMessage.id || `run-${runId}`;
            if (s.messages.some((message) => (message.id && message.id === id) || message === finalMessage)) {
              return {};
            }
            return {
              messages: [
                ...s.messages,
                {
                  ...finalMessage,
                  role: (finalMessage.role || 'assistant') as RawMessage['role'],
                  id,
                  timestamp: finalMessage.timestamp ?? Date.now(),
                },
              ],
            };
          });
        } else {
          void get().loadHistory(true);
        }
      }
      return;
    }

    // Only process events for the active run (or if no active run set)

    _lastChatEventAt = Date.now();

    // Defensive: if state is missing but we have a message, try to infer state.
    let resolvedState = eventState;
    if (!resolvedState && event.message && typeof event.message === 'object') {
      const msg = event.message as Record<string, unknown>;
      const stopReason = msg.stopReason ?? msg.stop_reason;
      if (stopReason) {
        resolvedState = 'final';
      } else if (msg.role || msg.content) {
        resolvedState = 'delta';
      }
    }

    // Match OpenClaw dashboard: chat events drive the live run, and
    // authoritative history is reloaded only after terminal chat events.
    const hasUsefulData =
      resolvedState === 'delta' ||
      resolvedState === 'final' ||
      resolvedState === 'error' ||
      resolvedState === 'aborted';
    if (hasUsefulData) {
      // Adopt run started from another client (e.g. console at 127.0.0.1:18789):
      // show loading/streaming in the app when this session has an active run.
      const { sending } = get();
      if (!sending && runId) {
        set({ sending: true, activeRunId: runId, error: null });
      }
      // Keep the optimistic user message until chat.history confirms it exists.
      // Gateway delta/final events often arrive before the authoritative history
      // includes the user's turn, so clearing it here causes a visible flash-out.
    }

    switch (resolvedState) {
      case 'started': {
        // Run just started (e.g. from console); show loading immediately.
        const { sending: currentSending } = get();
        if (!currentSending && runId) {
          set({ sending: true, activeRunId: runId, error: null });
        }
        break;
      }
      case 'delta': {
        const updates = collectToolUpdates(event.message, resolvedState);
        set((s) => ({
          streamingMessage: (() => {
            if (event.message && typeof event.message === 'object') {
              const msgRole = (event.message as RawMessage).role;
              if (isToolResultRole(msgRole)) return s.streamingMessage;
            }
            return mergeStreamingMessages(s.streamingMessage, event.message ?? s.streamingMessage);
          })(),
          streamingTools:
            updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
        }));
        break;
      }
      case 'final': {
        if (get().error) set({ error: null });
        // Match OpenClaw dashboard terminal handling: only tool-backed runs
        // need an authoritative history reload before queued messages resume,
        // because resetting the live tool stream would otherwise drop persisted
        // tool results from the visible transcript.
        const hadToolEventsBeforeTerminal =
          get().toolStreamOrder.length > 0
          || get().chatToolMessages.length > 0
          || get().chatStreamSegments.length > 0;
        // Message complete - add to history and clear streaming
        const finalMsg = event.message as RawMessage | undefined;
        // Some runtimes emit `chat.final` with no role/content. OpenClaw dashboard
        // keeps any streamed assistant text as the final visible answer in this case.
        if (!finalMsg?.role && !finalMsg?.content && !finalMsg?.toolCallId) {
          const shouldRefreshSessionModel = get().pendingSessionModelRefresh;
          const streamFallback = buildAssistantMessageFromStream(get(), runId);
          set((s) => ({
            streamingText: '',
            streamingMessage: null,
            streamingTools: [],
            pendingToolImages: [],
            sending: false,
            activeRunId: null,
            pendingFinal: false,
            pendingAssistantMessage: streamFallback,
            pendingSessionModelRefresh: false,
            terminalHistoryReconciling: false,
            ...(streamFallback ? resetToolStreamState(s) : {}),
          }));
          if (shouldRefreshSessionModel) {
            void get().loadSessions({ preserveCurrent: true, warmLabels: true });
          }
          get().requestQueueFlush(runId || null);
          if (streamFallback) void get().loadHistory(true);
          break;
        }
        if (finalMsg) {
          const updates = collectToolUpdates(finalMsg, resolvedState);
          if (isToolResultRole(finalMsg.role)) {
            // Resolve file path from the streaming assistant message's matching tool call
            const currentStreamForPath = get().streamingMessage as RawMessage | null;
            const matchedPath =
              currentStreamForPath && finalMsg.toolCallId
                ? getToolCallFilePath(currentStreamForPath, finalMsg.toolCallId)
                : undefined;

            // Mirror enrichWithToolResultFiles: collect images + file refs for next assistant msg
            const toolFiles: AttachedFileMeta[] = [
              ...extractImagesAsAttachedFiles(finalMsg.content),
            ];
            if (matchedPath) {
              for (const f of toolFiles) {
                if (!f.filePath) {
                  f.filePath = matchedPath;
                  f.fileName = matchedPath.split(/[\\/]/).pop() || 'image';
                }
              }
            }
            const text = getMessageText(finalMsg.content);
            if (text) {
              const mediaRefs = extractMediaRefs(text);
              const mediaRefPaths = new Set(mediaRefs.map((r) => r.filePath));
              for (const ref of mediaRefs) toolFiles.push(makeAttachedFile(ref));
              for (const ref of extractRawFilePaths(text)) {
                if (!mediaRefPaths.has(ref.filePath)) toolFiles.push(makeAttachedFile(ref));
              }
            }
            set((s) => ({
              streamingText: '',
              streamingMessage: null,
              pendingFinal: true,
              pendingAssistantMessage: null,
              pendingToolImages:
                toolFiles.length > 0
                  ? [...s.pendingToolImages, ...toolFiles]
                  : s.pendingToolImages,
              streamingTools:
                updates.length > 0
                  ? upsertToolStatuses(s.streamingTools, updates)
                  : s.streamingTools,
            }));
            break;
          }
          const toolOnly = isToolOnlyMessage(finalMsg);
          const hasOutput = hasNonToolAssistantContent(finalMsg);
          const shouldRefreshSessionModel = get().pendingSessionModelRefresh;
          if (!toolOnly && !hasOutput) {
            const streamFallback = buildAssistantMessageFromStream(get(), runId);
            set((s) => ({
              streamingText: '',
              streamingMessage: null,
              streamingTools: [],
              pendingToolImages: [],
              sending: false,
              activeRunId: null,
              pendingFinal: false,
              pendingAssistantMessage: streamFallback,
              pendingSessionModelRefresh: false,
              terminalHistoryReconciling: false,
              ...(streamFallback ? resetToolStreamState(s) : {}),
            }));
            if (shouldRefreshSessionModel) {
              void get().loadSessions({ preserveCurrent: true, warmLabels: true });
            }
            get().requestQueueFlush(runId || null);
            if (streamFallback) void get().loadHistory(true);
            break;
          }
          const msgId =
            finalMsg.id || (toolOnly ? `run-${runId}-tool-${Date.now()}` : `run-${runId}`);
          set((s) => {
            const nextTools =
              updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools;
            const streamingTools = hasOutput ? [] : nextTools;

            // Attach any images collected from preceding tool results
            const pendingImgs = s.pendingToolImages;
            const msgWithImages: RawMessage =
              pendingImgs.length > 0
                ? {
                    ...finalMsg,
                    role: (finalMsg.role || 'assistant') as RawMessage['role'],
                    id: msgId,
                    _attachedFiles: [...(finalMsg._attachedFiles || []), ...pendingImgs],
                  }
                : {
                    ...finalMsg,
                    role: (finalMsg.role || 'assistant') as RawMessage['role'],
                    id: msgId,
                  };
            const clearPendingImages = { pendingToolImages: [] as AttachedFileMeta[] };

            // Check if message already exists (prevent duplicates)
            const alreadyExists = s.messages.some((m) => m.id === msgId);
            if (alreadyExists) {
              return toolOnly
                ? {
                    streamingText: '',
                    streamingMessage: null,
                    pendingFinal: true,
                    pendingAssistantMessage: null,
                    streamingTools,
                    ...clearPendingImages,
                    ...resetToolStreamState(s),
                  }
                : {
                    streamingText: '',
                    streamingMessage: null,
                    sending: hasOutput ? false : s.sending,
                    activeRunId: hasOutput ? null : s.activeRunId,
                    pendingFinal: hasOutput ? false : true,
                    terminalHistoryReconciling: false,
                    pendingUserMessage: s.pendingUserMessage,
                    pendingAssistantMessage: null,
                    pendingSessionModelRefresh: hasOutput ? false : s.pendingSessionModelRefresh,
                    streamingTools,
                    ...clearPendingImages,
                    ...(hasOutput ? resetToolStreamState(s) : {}),
                  };
            }
            return toolOnly
              ? {
                  streamingText: '',
                  streamingMessage: null,
                  pendingFinal: true,
                  terminalHistoryReconciling: false,
                  pendingAssistantMessage: null,
                  streamingTools,
                  ...clearPendingImages,
                  ...resetToolStreamState(s),
                }
              : {
                  streamingText: '',
                  streamingMessage: null,
                  sending: hasOutput ? false : s.sending,
                  activeRunId: hasOutput ? null : s.activeRunId,
                  pendingFinal: hasOutput ? false : true,
                  pendingUserMessage: s.pendingUserMessage,
                  pendingAssistantMessage: hasOutput ? msgWithImages : null,
                  pendingSessionModelRefresh: hasOutput ? false : s.pendingSessionModelRefresh,
                  streamingTools,
                  ...clearPendingImages,
                  ...(hasOutput ? resetToolStreamState(s) : {}),
                };
          });
          // After the final response, quietly reload history to surface all intermediate
          // tool-use turns (thinking + tool blocks) from the Gateway's authoritative record.
          if (hasOutput && !toolOnly) {
            clearHistoryPoll();
            if (shouldRefreshSessionModel) {
              void get().loadSessions({ preserveCurrent: true, warmLabels: true });
            }
            if (hadToolEventsBeforeTerminal) {
              set({ terminalHistoryReconciling: true });
              void get().loadHistory(true).finally(() => {
                set({ terminalHistoryReconciling: false });
                get().requestQueueFlush(runId || null);
              });
            } else {
              get().requestQueueFlush(runId || null);
              void get().loadHistory(true);
            }
          }
        } else {
          // No message in final event - reload history to get complete data
          const shouldRefreshSessionModel = get().pendingSessionModelRefresh;
          set((s) => ({
            streamingText: '',
            streamingMessage: null,
            pendingFinal: true,
            terminalHistoryReconciling: false,
            pendingAssistantMessage: null,
            pendingSessionModelRefresh: false,
            ...resetToolStreamState(s),
          }));
          if (shouldRefreshSessionModel) {
            void get().loadSessions({ preserveCurrent: true, warmLabels: true });
          }
          if (hadToolEventsBeforeTerminal) {
            set({ terminalHistoryReconciling: true });
            get().loadHistory(true).finally(() => {
              set({ terminalHistoryReconciling: false });
              get().requestQueueFlush(runId || null);
            });
          } else {
            get().requestQueueFlush(runId || null);
            void get().loadHistory(true);
          }
        }
        break;
      }
      case 'error': {
        const errorMsg = String(event.errorMessage || 'An error occurred');

        const currentStream = get().streamingMessage as RawMessage | null;
        const errorAssistantSnapshot =
          currentStream &&
          (currentStream.role === 'assistant' || currentStream.role === undefined)
            ? {
                ...currentStream,
                role: 'assistant' as const,
                id: (currentStream as RawMessage).id || `error-snap-${Date.now()}`,
              }
            : null;

        set({
          error: errorMsg,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          pendingAssistantMessage: errorAssistantSnapshot,
          pendingSessionModelRefresh: false,
          pendingToolImages: [],
          sending: false,
          activeRunId: null,
          lastUserMessageAt: null,
          pendingUserMessage: null,
          terminalHistoryReconciling: false,
          ...resetToolStreamState(get()),
        });
        clearHistoryPoll();
        get().requestQueueFlush(runId || null);
        break;
      }
      case 'aborted': {
        clearHistoryPoll();
        const abortedMessage = event.message as RawMessage | undefined;
        const currentStream = get().streamingMessage as RawMessage | null;
        const streamedText =
          currentStream && typeof currentStream === 'object'
            ? extractTextFromContent(currentStream.content)
            : '';
        const pendingAssistantSnapshot =
          abortedMessage
          && (abortedMessage.role === 'assistant' || abortedMessage.role === undefined)
          && !isAssistantSilentReply(abortedMessage)
          && hasNonToolAssistantContent(abortedMessage)
            ? {
                ...abortedMessage,
                role: 'assistant' as const,
                id: abortedMessage.id || `aborted-${runId || Date.now()}`,
                timestamp: abortedMessage.timestamp ?? Date.now(),
              }
            : streamedText.trim() && !isSilentReplyText(streamedText)
              ? {
                  role: 'assistant' as const,
                  id: `aborted-stream-${runId || Date.now()}`,
                  content: [{ type: 'text' as const, text: streamedText }],
                  timestamp: Date.now(),
                }
              : null;
        set((s) => ({
          ...resetChatRuntimeActivity(s),
          sending: false,
          activeRunId: null,
          pendingFinal: false,
          pendingAssistantMessage: pendingAssistantSnapshot,
          pendingSessionModelRefresh: false,
          lastUserMessageAt: null,
        }));
        get().requestQueueFlush(runId || null);
        break;
      }
      default: {
        // Unknown or empty state — if we're currently sending and receive an event
        // with a message, attempt to process it as streaming data. This handles
        // edge cases where the Gateway sends events without a state field.
        const { sending } = get();
        if (sending && event.message && typeof event.message === 'object') {
          console.warn(
            `[handleChatEvent] Unknown event state "${resolvedState}", treating message as streaming delta. Event keys:`,
            Object.keys(event)
          );
          const updates = collectToolUpdates(event.message, 'delta');
          set((s) => ({
            streamingMessage: mergeStreamingMessages(
              s.streamingMessage,
              event.message ?? s.streamingMessage
            ),
            streamingTools:
              updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
          }));
        }
        break;
      }
    }
  },

  handleBtwEvent: ({ question, text, isError }) => {
    const btwMsg: RawMessage = {
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
      btw: { question, isError },
    };

    set((s) => ({ btwMessages: [...s.btwMessages, btwMsg] }));
  },

  handleAgentEvent: (event: AgentStreamEvent) => {
    if (!event) return;

    const { currentSessionKey, sessions, activeRunId } = get();
    const eventSessionKey = typeof event.sessionKey === 'string' ? event.sessionKey : '';
    if (eventSessionKey && !sessionKeysMatch(currentSessionKey, eventSessionKey, sessions)) return;

    const incomingRunId = typeof event.runId === 'string' ? event.runId : '';
    // Match OpenClaw dashboard tool-stream handling: tool events are scoped by
    // session, not by chatRunId. Some runtimes emit tool events with an engine
    // run id that differs from the chat.send run/idempotency id, so filtering
    // tool events by activeRunId drops live tool cards and can make replies
    // appear incomplete.
    if (event.stream !== 'tool' && activeRunId && incomingRunId && incomingRunId !== activeRunId) return;

    if (event.stream === 'compaction') {
      const data = event.data && typeof event.data === 'object' ? event.data : {};
      const phase = typeof data.phase === 'string' ? data.phase : '';
      const completed = data.completed === true;
      clearCompactionTimer();
      if (phase === 'start') {
        set({
          compactionStatus: {
            phase: 'active',
            runId: incomingRunId || null,
            startedAt: Date.now(),
            completedAt: null,
          },
        });
      } else if (phase === 'end') {
        if (data.willRetry === true && completed) {
          set((s) => ({
            compactionStatus: {
              phase: 'retrying',
              runId: incomingRunId || s.compactionStatus?.runId || null,
              startedAt: s.compactionStatus?.startedAt ?? Date.now(),
              completedAt: null,
            },
          }));
          return;
        }
        if (!completed) {
          set({ compactionStatus: null });
          return;
        }
        set((s) => ({
          compactionStatus: {
            phase: 'complete',
            runId: incomingRunId || s.compactionStatus?.runId || null,
            startedAt: s.compactionStatus?.startedAt ?? null,
            completedAt: Date.now(),
          },
        }));
        _compactionClearTimer = setTimeout(() => {
          _compactionClearTimer = null;
          set({ compactionStatus: null });
        }, COMPACTION_TOAST_DURATION_MS);
      }
      return;
    }

    if (event.stream === 'lifecycle') {
      const data = event.data && typeof event.data === 'object' ? event.data : {};
      const phase = toTrimmedString(data.phase);
      if (phase === 'end' || phase === 'error') {
        const currentCompaction = get().compactionStatus;
        if (
          currentCompaction?.phase === 'retrying'
          && (!currentCompaction.runId || !incomingRunId || currentCompaction.runId === incomingRunId)
        ) {
          clearCompactionTimer();
          set((s) => ({
            compactionStatus: {
              phase: 'complete',
              runId: incomingRunId || s.compactionStatus?.runId || null,
              startedAt: s.compactionStatus?.startedAt ?? null,
              completedAt: Date.now(),
            },
          }));
          _compactionClearTimer = setTimeout(() => {
            _compactionClearTimer = null;
            set({ compactionStatus: null });
          }, COMPACTION_TOAST_DURATION_MS);
        }
      }
    }

    if (event.stream === 'lifecycle' || event.stream === 'fallback') {
      const data = event.data && typeof event.data === 'object' ? event.data : {};
      const phase = event.stream === 'fallback' ? 'fallback' : toTrimmedString(data.phase);
      if (event.stream === 'lifecycle' && phase !== 'fallback' && phase !== 'fallback_cleared') {
        return;
      }

      const selected =
        resolveModelLabel(data.selectedProvider, data.selectedModel)
        ?? resolveModelLabel(data.fromProvider, data.fromModel);
      const active =
        resolveModelLabel(data.activeProvider, data.activeModel)
        ?? resolveModelLabel(data.toProvider, data.toModel);
      const previous =
        resolveModelLabel(data.previousActiveProvider, data.previousActiveModel)
        ?? toTrimmedString(data.previousActiveModel)
        ?? undefined;
      if (!selected || !active) {
        return;
      }
      if (phase === 'fallback' && selected === active) {
        return;
      }

      const reason = toTrimmedString(data.reasonSummary) ?? toTrimmedString(data.reason) ?? undefined;
      const attempts = (() => {
        const summaries = parseFallbackAttemptSummaries(data.attemptSummaries);
        if (summaries.length > 0) {
          return summaries;
        }
        return parseFallbackAttempts(data.attempts).map((attempt) => {
          const modelRef = resolveModelLabel(attempt.provider, attempt.model);
          return `${modelRef ?? `${attempt.provider}/${attempt.model}`}: ${attempt.reason}`;
        });
      })();

      clearFallbackTimer();
      set({
        fallbackStatus: {
          phase: phase === 'fallback_cleared' ? 'cleared' : 'active',
          selected,
          active: phase === 'fallback_cleared' ? selected : active,
          previous: phase === 'fallback_cleared'
            ? (previous ?? (active !== selected ? active : undefined))
            : undefined,
          reason,
          attempts,
          occurredAt: Date.now(),
        },
      });
      _fallbackClearTimer = setTimeout(() => {
        _fallbackClearTimer = null;
        set({ fallbackStatus: null });
      }, FALLBACK_TOAST_DURATION_MS);
      return;
    }

    if (event.stream !== 'tool') return;

    if (incomingRunId) {
      set((s) => ({
        sending: true,
        activeRunId: s.activeRunId || incomingRunId,
        error: null,
      }));
    }

    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
    if (!toolCallId) return;

    const name = typeof data.name === 'string' ? data.name : 'tool';
    const phase = typeof data.phase === 'string' ? data.phase : '';
    const args = phase === 'start' ? (data.args ?? data.arguments) : undefined;
    const output =
      phase === 'update'
        ? formatToolOutput(data.partialResult)
        : phase === 'result'
          ? formatToolOutput(data.result)
          : undefined;
    const now = Date.now();
    const startedAt = typeof event.ts === 'number' ? toMs(event.ts) : now;

    set((s) => {
      let nextById = new Map(s.toolStreamById);
      let nextOrder = [...s.toolStreamOrder];
      let nextSegments = s.chatStreamSegments;
      let nextStreamingMessage = s.streamingMessage;

      let entry = nextById.get(toolCallId);
      if (!entry) {
        const currentStream = s.streamingMessage as RawMessage | null;
        const currentStreamText =
          currentStream && typeof currentStream === 'object'
            ? extractTextFromContent(currentStream.content)
            : '';
        if (currentStreamText.trim()) {
          nextSegments = [...nextSegments, { text: currentStreamText, ts: now }];
          nextStreamingMessage = null;
        }

        entry = {
          toolCallId,
          runId: incomingRunId,
          sessionKey: eventSessionKey || undefined,
          name,
          args,
          output,
          startedAt,
          updatedAt: now,
          message: {
            role: 'assistant',
            content: [],
            timestamp: startedAt,
          },
        };
        nextById.set(toolCallId, entry);
        nextOrder.push(toolCallId);
      } else {
        entry = {
          ...entry,
          name,
          args: args !== undefined ? args : entry.args,
          output: output !== undefined ? output : entry.output,
          updatedAt: now,
        };
        nextById.set(toolCallId, entry);
      }

      entry.message = buildToolStreamMessage(entry);
      const trimmed = trimToolStream(nextById, nextOrder);
      nextById = trimmed.toolStreamById;
      nextOrder = trimmed.toolStreamOrder;

      const toolUpdate: ToolStatus = {
        id: entry.toolCallId,
        toolCallId: entry.toolCallId,
        name: entry.name,
        status: phase === 'result' ? 'completed' : 'running',
        summary: entry.output ? summarizeToolOutput(entry.output) : undefined,
        updatedAt: now,
      };

      return {
        toolStreamById: nextById,
        toolStreamOrder: nextOrder,
        chatToolMessages: syncToolStreamMessages(nextById, nextOrder),
        chatStreamSegments: nextSegments,
        streamingMessage: nextStreamingMessage,
        streamingTools: upsertToolStatuses(s.streamingTools, [toolUpdate]),
        sending: s.sending || Boolean(incomingRunId),
        activeRunId: s.activeRunId || incomingRunId || null,
      };
    });
  },

  handleGatewayStatusChange: (gatewayState) => {
    const state = get();
    const responseInProgress = state.sending || Boolean(state.activeRunId) || state.pendingFinal;

    if (gatewayState === 'running') {
      if (responseInProgress || state.error?.startsWith('Gateway is reconnecting') || state.error?.startsWith('Gateway is starting')) {
        void state.loadHistory(true);
        set({ error: null });
      }
      return;
    }

    const nextError = getGatewayStatusErrorMessage(gatewayState);
    if (!nextError || !responseInProgress) return;


    if (gatewayState === 'reconnecting' || gatewayState === 'starting') {
      set({ error: nextError });
      return;
    }

    clearHistoryPoll();
    set((s) => ({
      error: nextError,
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      terminalHistoryReconciling: false,
      pendingSessionModelRefresh: false,
      lastUserMessageAt: null,
      ...resetChatRuntimeActivity(s),
    }));
  },

  // ── Toggle thinking visibility ──

  toggleThinking: () => set((s) => ({ showThinking: !s.showThinking })),

  // ── Refresh: reload history + sessions ──

  refresh: async () => {
    const { loadHistory, loadSessions } = get();
    await loadSessions({ preserveCurrent: true });
    await loadHistory();
  },

  clearError: () => set({ error: null }),
}));
