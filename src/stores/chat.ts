/**
 * Chat State Store
 * Manages chat messages, sessions, streaming, and thinking state.
 * Communicates with OpenClaw Gateway via renderer WebSocket RPC.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { extractText } from '@/pages/Chat/message-utils';
import { useGatewayStore } from './gateway';
import { useAgentsStore } from './agents';

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
export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult' | 'compactionSummary';
  content: unknown; // string | ContentBlock[]
  timestamp?: number;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  model?: string;
  usage?: Record<string, number>;
  cost?: Record<string, number>;
  details?: unknown;
  isError?: boolean;
  /** Local-only: file metadata for user-uploaded attachments (not sent to/from Gateway) */
  _attachedFiles?: AttachedFileMeta[];
}

type HistoryAnchor = {
  role?: string;
  timestamp?: number;
  id?: string;
  toolCallId?: string;
};

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

export interface CompactionStatus {
  active: boolean;
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
}

interface ChatState {
  // Messages
  messages: RawMessage[];
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
  sessionsHydrated: boolean;
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

  // Thinking
  showThinking: boolean;
  thinkingLevel: string | null;
  allowedModelRefs: string[];
  defaultModelRef?: string;

  // Actions
  loadSessions: (options?: boolean | LoadSessionsOptions) => Promise<void>;
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

/** Normalize a timestamp to milliseconds. Handles both seconds and ms. */
function toMs(ts: number): number {
  // Timestamps < 1e12 are in seconds (before ~2033); >= 1e12 are milliseconds
  return ts < 1e12 ? ts * 1000 : ts;
}

// Timer for fallback history polling during active sends.
// If no streaming events arrive within a few seconds, we periodically
// poll chat.history to surface intermediate tool-call turns.
let _historyPollTimer: ReturnType<typeof setTimeout> | null = null;
let _historyLoadSeq = 0;
let _sessionRestorePromise: Promise<void> | null = null;
const HISTORY_POLL_START_DELAY_MS = 3000;
const HISTORY_POLL_INTERVAL_MS = 4000;
const CHAT_HISTORY_PAGE_LIMIT = 200;

function getRawMessageKey(message: Partial<RawMessage>): string {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : '';
  if (toolCallId) return `tool:${toolCallId}`;
  const id = typeof message.id === 'string' ? message.id : '';
  if (id) return `msg:${id}`;
  const timestamp = typeof message.timestamp === 'number' ? message.timestamp : null;
  const role = typeof message.role === 'string' ? message.role : 'unknown';
  if (timestamp != null) return `msg:${role}:${timestamp}`;
  return `msg:${role}`;
}

function toHistoryAnchor(message: RawMessage | undefined): HistoryAnchor | null {
  if (!message) return null;
  return {
    role: message.role,
    timestamp: message.timestamp,
    ...(typeof message.id === 'string' ? { id: message.id } : {}),
    ...(typeof message.toolCallId === 'string' ? { toolCallId: message.toolCallId } : {}),
  };
}

// Timer for delayed error finalization. When the Gateway reports a mid-stream
// error (e.g. "terminated"), it may retry internally and recover. We wait
// before committing the error to give the recovery path a chance.
let _errorRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
let _compactionClearTimer: ReturnType<typeof setTimeout> | null = null;
let _fallbackClearTimer: ReturnType<typeof setTimeout> | null = null;
const COMPACTION_TOAST_DURATION_MS = 5000;
const FALLBACK_TOAST_DURATION_MS = 8000;

function clearErrorRecoveryTimer(): void {
  if (_errorRecoveryTimer) {
    clearTimeout(_errorRecoveryTimer);
    _errorRecoveryTimer = null;
  }
}

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

function ensureHistoryPollRunning(getState: () => ChatState): void {
  if (_historyPollTimer) return;

  const pollHistory = () => {
    const state = getState();
    if (!state.sending) {
      clearHistoryPoll();
      return;
    }
    void state.loadHistory(true);
    _historyPollTimer = setTimeout(pollHistory, HISTORY_POLL_INTERVAL_MS);
  };

  _historyPollTimer = setTimeout(pollHistory, HISTORY_POLL_START_DELAY_MS);
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
    };
  }

  return {
    preferMostRecent: Boolean(options?.preferMostRecent),
    preserveCurrent: Boolean(options?.preserveCurrent),
    warmLabels: options?.warmLabels ?? true,
  };
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
  pendingLocalSessionKeys: Record<string, true>
): boolean {
  return Boolean(pendingLocalSessionKeys[sessionKey]) && messages.length === 0;
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

function resolveSessionSidebarTitle(session: Pick<ChatSession, 'derivedTitle' | 'label' | 'displayName' | 'key'>): string | undefined {
  const title = normalizeSessionTitleCandidate(session.derivedTitle || session.label || '');
  if (title) return title;
  const displayName = normalizeSessionTitleCandidate(session.displayName || '');
  if (displayName && displayName !== session.key && isMainSessionKey(session.key)) {
    return displayName;
  }
  return undefined;
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

// ── Store ────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
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
  lastUserMessageAt: null,
  pendingToolImages: [],
  toolStreamById: new Map<string, ToolStreamEntry>(),
  toolStreamOrder: [],

  sessions: [{ key: INITIAL_SESSION_KEY, displayName: INITIAL_SESSION_KEY }],
  sessionsLoading: false,
  sessionsHydrated: false,
  currentSessionKey: INITIAL_SESSION_KEY,
  currentAgentId: INITIAL_AGENT_ID,
  sessionLabels: {},
  sessionLastActivity: { [INITIAL_SESSION_KEY]: Date.now() },
  pendingLocalSessionKeys: {},
  pendingSessionModelRefresh: false,
  historyWindowLimited: false,
  hasEarlierHistory: false,
  loadingEarlierHistory: false,

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

  loadSessions: async (options) => {
    const { preferMostRecent, preserveCurrent, warmLabels } = normalizeLoadSessionsOptions(options);
    set({ sessionsLoading: true });
    try {
      const data = await useGatewayStore
        .getState()
        .rpc<Record<string, unknown>>('sessions.list', {
          includeDerivedTitles: true,
          includeLastMessage: true,
        });
      if (data) {
        const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
        const sessions: ChatSession[] = rawSessions
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
            updatedAt:
              typeof s.updatedAt === 'number'
                ? s.updatedAt
                : typeof s.updatedAt === 'string'
                  ? Number(s.updatedAt)
                  : undefined,
          }))
          .filter((s: ChatSession) => s.key && isChatSidebarSessionKey(s.key));
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
        let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
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
              const agentsState = useAgentsStore.getState();
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
          Object.entries(pendingLocalSessionKeys).filter(([key]) => !realSessionKeys.has(key))
        ) as Record<string, true>;

        set({
          sessions: sessionsWithCurrent,
          sessionsLoading: false,
          sessionsHydrated: true,
          currentSessionKey: nextSessionKey,
          currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
          pendingLocalSessionKeys: nextPendingLocalSessionKeys,
          historyWindowLimited: false,
          hasEarlierHistory: false,
          loadingEarlierHistory: false,
          sessionLabels: hydratedSessionLabels,
          sessionLastActivity: hydratedSessionLastActivity,
        });
        persistCurrentSessionKey(nextSessionKey);

        if (currentSessionKey !== nextSessionKey) {
          get().loadHistory();
        }

        // Background: fetch first user message for every non-main session to populate labels upfront.
        // Uses a small limit so it's cheap; runs in parallel and doesn't block anything.
        const sessionsToLabel = sessionsWithCurrent.filter((session) => {
          if (session.key.endsWith(':main')) return false;
          if (!realSessionKeys.has(session.key)) return false;
          return !resolveSessionSidebarTitle(session);
        });
        if (warmLabels && sessionsToLabel.length > 0) {
          void Promise.all(
            sessionsToLabel.map(async (session) => {
              try {
                const r = await useGatewayStore
                  .getState()
                  .rpc<
                    Record<string, unknown>
                  >('chat.history', { sessionKey: session.key, limit: 1000 });
                const msgs = Array.isArray(r.messages) ? (r.messages as RawMessage[]) : [];
                const lastMsg = msgs[msgs.length - 1];
                set((s) => {
                  const next: Partial<typeof s> = {};
                  const isEmptyEphemeral =
                    msgs.length === 0 &&
                    Boolean(s.pendingLocalSessionKeys[session.key]) &&
                    s.currentSessionKey !== session.key;
                  if (isEmptyEphemeral) {
                    Object.assign(next, removeSessionArtifacts(s, session.key));
                    return next;
                  }
                  const labelText = findSessionTitleCandidate(msgs);
                  if (labelText) {
                    const truncated =
                      labelText.length > 50 ? `${labelText.slice(0, 50)}…` : labelText;
                    next.sessionLabels = { ...s.sessionLabels, [session.key]: truncated };
                  }
                  if (lastMsg?.timestamp) {
                    next.sessionLastActivity = {
                      ...s.sessionLastActivity,
                      [session.key]: toMs(lastMsg.timestamp),
                    };
                  }
                  return next;
                });
              } catch {
                /* ignore per-session errors */
              }
            })
          );
        }
      }
    } catch (err) {
      console.warn('Failed to load sessions:', err);
      set({ sessionsLoading: false, sessionsHydrated: true });
    }
  },

  restoreSessionsAfterGatewayReady: async () => {
    if (_sessionRestorePromise) {
      await _sessionRestorePromise;
      return;
    }

    _sessionRestorePromise = (async () => {
      try {
        // Cold start should eagerly hydrate sidebar labels so recent conversations
        // do not temporarily fall back to the agent displayName ("ClawClaw")
        // until the user clicks into each session.
        await get().loadSessions({ preserveCurrent: true, warmLabels: true });
        await get().loadHistory(false);
      } finally {
        _sessionRestorePromise = null;
      }
    })();

    await _sessionRestorePromise;
  },

  // ── Switch session ──

  switchSession: (key: string) => {
    const { currentSessionKey, messages, pendingLocalSessionKeys } = get();
    const leavingEmpty =
      !currentSessionKey.endsWith(':main')
      && isEmptyEphemeralSession(currentSessionKey, messages, pendingLocalSessionKeys);
    set((s) => ({
      currentSessionKey: key,
      currentAgentId: getAgentIdFromSessionKey(key),
      messages: [],
      historyWindowLimited: false,
      hasEarlierHistory: false,
      loadingEarlierHistory: false,
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
        historyWindowLimited: false,
        hasEarlierHistory: false,
        loadingEarlierHistory: false,
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
    const { currentSessionKey, messages, pendingLocalSessionKeys } = get();
    const nextAgentId = targetAgentId || get().currentAgentId || useAgentsStore.getState().defaultAgentId || 'main';
    const isCurrentEmptyEphemeral =
      !currentSessionKey.endsWith(':main')
      && isEmptyEphemeralSession(currentSessionKey, messages, pendingLocalSessionKeys);
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
      historyWindowLimited: false,
      hasEarlierHistory: false,
      loadingEarlierHistory: false,
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
    const { currentSessionKey, messages, pendingLocalSessionKeys } = get();
    // Only remove non-main sessions that were never used (no messages sent).
    // This mirrors the "leavingEmpty" logic in switchSession so that creating
    // a new session and immediately navigating away doesn't leave a ghost entry
    // in the sidebar.
    const isEmptyNonMain =
      !currentSessionKey.endsWith(':main')
      && isEmptyEphemeralSession(currentSessionKey, messages, pendingLocalSessionKeys);
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

      if (targetProvider && !isCrossProvider) {
        queueAttempt(targetModelId);
        queueAttempt(modelForPatch);
      } else {
        queueAttempt(modelForPatch);
        queueAttempt(targetModelId);
      }

      if (isCrossProvider) {
        queueAttempt(providerDefaultRef);
        queueAttempt(providerDefaultId);
        queueAttempt(targetModelId);
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
    if (isEmptyEphemeralSession(requestSessionKey, get().messages, pendingLocalSessionKeys)) {
      set({
        ...(quiet ? {} : { loading: false }),
        error: null,
        messages: [],
        historyWindowLimited: false,
        hasEarlierHistory: false,
        loadingEarlierHistory: false,
      });
      return;
    }

    try {
      const data = await useGatewayStore
        .getState()
        .rpc<
          Record<string, unknown>
        >('chat.history', { sessionKey: requestSessionKey, limit: CHAT_HISTORY_PAGE_LIMIT });
      if (isStale()) {
        clearLoadingIfLatest();
        return;
      }
      if (data) {
        const rawMessages = (Array.isArray(data.messages) ? (data.messages as RawMessage[]) : [])
          .filter((message) => !isAssistantSilentReply(message));

        // Keep transcript ordering as close to Gateway history as possible.
        // Only enrich cached file/image previews for display.
        const enrichedMessages = enrichWithCachedImages(rawMessages);
        const thinkingLevel = data.thinkingLevel ? String(data.thinkingLevel) : null;

        // Preserve the optimistic user message during an active send.
        // The Gateway may not include the user's message in chat.history
        // until the run completes, causing it to flash out of the UI.
        let finalMessages = enrichedMessages;
        const userMsgAt = get().lastUserMessageAt;
        if (get().sending && userMsgAt) {
          const userMsMs = toMs(userMsgAt);
          const hasRecentUser = enrichedMessages.some(
            (m) => m.role === 'user' && m.timestamp && Math.abs(toMs(m.timestamp) - userMsMs) < 5000
          );
          if (!hasRecentUser) {
            const currentMsgs = get().messages;
            const optimistic = [...currentMsgs]
              .reverse()
              .find(
                (m) =>
                  m.role === 'user' && m.timestamp && Math.abs(toMs(m.timestamp) - userMsMs) < 5000
              );
            if (optimistic) {
              finalMessages = [...enrichedMessages, optimistic];
            }
          }
        }

        // Extract first user message text as a session label for display in the toolbar.
        // Skip main sessions (key ends with ":main") — they rely on the Gateway-provided
        // displayName (e.g. the configured agent name "ClawClaw") instead.
        const isMainSession = requestSessionKey.endsWith(':main');
        if (!isMainSession) {
          const labelText = findSessionTitleCandidate(finalMessages);
          if (labelText) {
            const truncated = labelText.length > 50 ? `${labelText.slice(0, 50)}…` : labelText;
            set((s) => ({
              sessionLabels: { ...s.sessionLabels, [requestSessionKey]: truncated },
            }));
          }
        }

        // Record last activity time from the last message in history
        const lastMsg = finalMessages[finalMessages.length - 1];
        if (lastMsg?.timestamp) {
          const lastAt = toMs(lastMsg.timestamp);
          set((s) => ({
            sessionLastActivity: { ...s.sessionLastActivity, [requestSessionKey]: lastAt },
          }));
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
        const stateBeforeCommit = get();
        const { pendingFinal, lastUserMessageAt, sending: isSendingNow } = stateBeforeCommit;
        if (isStale()) {
          clearLoadingIfLatest();
          return;
        }

        // If we're sending but haven't received streaming events, check
        // whether the loaded history reveals intermediate tool-call activity.
        // This surfaces progress via the pendingFinal → ActivityIndicator path.
        const userMsTs = lastUserMessageAt ? toMs(lastUserMessageAt) : 0;
        const isAfterUserMsg = (msg: RawMessage): boolean => {
          if (!userMsTs || !msg.timestamp) return true;
          return toMs(msg.timestamp) >= userMsTs;
        };
        const hasRecentAssistantActivity = [...enrichedMessages].reverse().some((msg) => {
          if (msg.role !== 'assistant' && msg.role !== 'toolresult') return false;
          return isAfterUserMsg(msg);
        });

        const shouldResetLiveState = !stateBeforeCommit.sending;
        set((s) => ({
          messages: finalMessages,
          thinkingLevel,
          historyWindowLimited: rawMessages.length >= CHAT_HISTORY_PAGE_LIMIT,
          hasEarlierHistory: rawMessages.length >= CHAT_HISTORY_PAGE_LIMIT,
          loadingEarlierHistory: false,
          loading: false,
          ...(shouldResetLiveState ? resetToolStreamState(s) : {}),
          ...(shouldResetLiveState ? { streamingText: '', streamingMessage: null, streamingTools: [] as ToolStatus[] } : {}),
        }));

        if (isSendingNow && !pendingFinal) {
          if (hasRecentAssistantActivity) {
            set({ pendingFinal: true });
          }
        }

        // If pendingFinal, check whether the AI produced a final text response.
        if (pendingFinal || get().pendingFinal) {
          const recentAssistant = [...enrichedMessages].reverse().find((msg) => {
            if (msg.role !== 'assistant') return false;
            if (!hasNonToolAssistantContent(msg)) return false;
            return isAfterUserMsg(msg);
          });
          if (recentAssistant) {
            clearHistoryPoll();
            set((s) => ({
              sending: false,
              activeRunId: null,
              pendingFinal: false,
              ...resetToolStreamState(s),
              streamingText: '',
              streamingMessage: null,
              streamingTools: [],
            }));
          }
        }
      } else {
        if (isStale()) {
          clearLoadingIfLatest();
          return;
        }
        set({ messages: [], loading: false, historyWindowLimited: false, hasEarlierHistory: false, loadingEarlierHistory: false });
      }
    } catch (err) {
      if (isStale()) {
        clearLoadingIfLatest();
        return;
      }
      console.warn('Failed to load chat history:', err);
      set({ messages: [], loading: false, historyWindowLimited: false, hasEarlierHistory: false, loadingEarlierHistory: false });
    }
  },

  loadEarlierHistory: async () => {
    const {
      currentSessionKey,
      messages,
      pendingLocalSessionKeys,
      loadingEarlierHistory,
      hasEarlierHistory,
    } = get();

    if (loadingEarlierHistory || !hasEarlierHistory) {
      return;
    }

    if (isEmptyEphemeralSession(currentSessionKey, messages, pendingLocalSessionKeys)) {
      set({ hasEarlierHistory: false, loadingEarlierHistory: false });
      return;
    }

    const anchorMessage = messages.find((message) => !isAssistantSilentReply(message));
    const before = toHistoryAnchor(anchorMessage);
    if (!before) {
      set({ hasEarlierHistory: false, loadingEarlierHistory: false });
      return;
    }

    set({ loadingEarlierHistory: true, error: null });

    try {
      const data = await hostApiFetch<{
        success: boolean;
        messages?: RawMessage[];
        hasMore?: boolean;
        anchorFound?: boolean;
      }>('/api/sessions/history', {
        method: 'POST',
        body: JSON.stringify({
          sessionKey: currentSessionKey,
          limit: CHAT_HISTORY_PAGE_LIMIT,
          before,
        }),
      });

      const currentSessionStillActive = get().currentSessionKey === currentSessionKey;
      if (!currentSessionStillActive) {
        return;
      }

      const rawMessages = (Array.isArray(data.messages) ? data.messages : [])
        .filter((message) => !isAssistantSilentReply(message));
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
          hasEarlierHistory: data.anchorFound === false ? false : data.hasMore === true,
          historyWindowLimited: data.anchorFound === false ? false : data.hasMore === true,
          loadingEarlierHistory: false,
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
    const currentAgent = useAgentsStore.getState().agents.find((agent) => agent.gateway.id === currentAgentId);
    const shouldApplyAgentModel =
      !currentSession?.model?.trim()
      && Boolean(currentAgent?.local.modelRef)
      && !currentAgent?.local.inheritedModel;

    if (shouldApplyAgentModel && currentAgent?.local.modelRef) {
      try {
        await get().setSessionModel(currentAgent.local.modelRef);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({
          error: `Failed to initialize session model for agent ${currentAgent.gateway.id}: ${message}`,
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

    // Add user message optimistically (with local file metadata for UI display)
    const nowMs = Date.now();
    const userMsg: RawMessage = {
      role: 'user',
      content: trimmed || (attachments?.length ? '(file attached)' : ''),
      timestamp: nowMs / 1000,
      id: crypto.randomUUID(),
      _attachedFiles: attachments?.map((a) => ({
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
        preview: a.preview,
        filePath: a.stagedPath,
      })),
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      sending: true,
      error: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      chatToolMessages: [],
      chatStreamSegments: [],
      pendingFinal: false,
      lastUserMessageAt: nowMs,
      pendingSessionModelRefresh: isSlashModelCommandText(trimmed),
      toolStreamById: new Map<string, ToolStreamEntry>(),
      toolStreamOrder: [],
    }));

    // Update session label with first user message text as soon as it's sent
    const { sessionLabels, messages } = get();
    const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
    if (
      !currentSessionKey.endsWith(':main') &&
      isFirstMessage &&
      !sessionLabels[currentSessionKey] &&
      trimmed
    ) {
      const truncated = trimmed.length > 50 ? `${trimmed.slice(0, 50)}…` : trimmed;
      set((s) => ({ sessionLabels: { ...s.sessionLabels, [currentSessionKey]: truncated } }));
    }

    // Mark this session as most recently active
    set((s) => ({ sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: nowMs } }));

    // Start the history poll and safety timeout IMMEDIATELY (before the
    // RPC await) because the gateway's chat.send RPC may block until the
    // entire agentic conversation finishes — the poll must run in parallel.
    _lastChatEventAt = Date.now();
    clearHistoryPoll();
    clearErrorRecoveryTimer();

    ensureHistoryPollRunning(get);

    const SAFETY_TIMEOUT_MS = 90_000;
    const checkStuck = () => {
      const state = get();
      if (!state.sending) return;
      if (state.streamingMessage || state.streamingText) return;
      if (state.pendingFinal) {
        setTimeout(checkStuck, 10_000);
        return;
      }
      if (Date.now() - _lastChatEventAt < SAFETY_TIMEOUT_MS) {
        setTimeout(checkStuck, 10_000);
        return;
      }
      clearHistoryPoll();
      set({
        error:
          'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
        sending: false,
        activeRunId: null,
        lastUserMessageAt: null,
        ...resetToolStreamState(get()),
      });
    };
    setTimeout(checkStuck, 30_000);

    try {
      const createIdempotencyKey = () => crypto.randomUUID();
      const hasMedia = attachments && attachments.length > 0;
      if (hasMedia) {
        console.log(
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

      // Longer timeout for chat sends to tolerate high-latency networks (avoids connect error)
      const CHAT_SEND_TIMEOUT_MS = 120_000;

      const executeSend = async (idempotencyKey: string) => {
        if (hasMedia) {
          return await hostApiFetch<{
            success: boolean;
            result?: { runId?: string };
            error?: string;
          }>('/api/chat/send-with-media', {
            method: 'POST',
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

      result = await executeSend(createIdempotencyKey());

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

          result = await executeSend(createIdempotencyKey());
        } catch {
          // Keep the original error handling below if fallback patch/retry fails.
        }
      }

      console.log(
        `[sendMessage] RPC result: success=${result.success}, runId=${result.result?.runId || 'none'}`
      );

      if (!result.success) {
        clearHistoryPoll();
        // ✅ Fix HR-1: Roll back the optimistically-added user message on failure.
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== userMsg.id),
          error: result.error || 'Failed to send message',
          sending: false,
          activeRunId: null,
          ...resetToolStreamState(get()),
        }));
      } else if (result.result?.runId) {
        set({ activeRunId: result.result.runId });
      }
    } catch (err) {
      clearHistoryPoll();
      // ✅ Fix HR-1: Roll back the optimistically-added user message on error.
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== userMsg.id),
        error: String(err),
        sending: false,
        activeRunId: null,
        ...resetToolStreamState(get()),
      }));
    }
  },

  // ── Abort active run ──

  abortRun: async () => {
    clearHistoryPoll();
    clearErrorRecoveryTimer();
    const { currentSessionKey } = get();
    set({
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      ...resetToolStreamState(get()),
    });
    set({ streamingTools: [] });

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
    clearErrorRecoveryTimer();
    set({
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: message,
      ...resetToolStreamState(get()),
    });
    set({ streamingTools: [] });

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
    if (eventSessionKey != null && !sessionKeysMatch(currentSessionKey, eventSessionKey, sessions)) return;

    // Final from another run (e.g. sub-agent announce): refresh history to show new message.
    // See https://github.com/openclaw/openclaw/issues/1909
    if (activeRunId && runId && runId !== activeRunId) {
      if (eventState === 'final') {
        const finalMsg = event.message as RawMessage | undefined;
        if (finalMsg && !isAssistantSilentReply(finalMsg)) {
          set((s) => ({ messages: [...s.messages, finalMsg] }));
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

    // Keep the history poll running during sends even when live events arrive.
    // Some intermediate transcript turns only become visible via chat.history,
    // so cancelling the poll here can leave the UI stuck until manual refresh.
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
    }

    switch (resolvedState) {
      case 'started': {
        // Run just started (e.g. from console); show loading immediately.
        const { sending: currentSending } = get();
        if (!currentSending && runId) {
          set({ sending: true, activeRunId: runId, error: null });
        }
        ensureHistoryPollRunning(get);
        break;
      }
      case 'delta': {
        // If we're receiving new deltas, the Gateway has recovered from any
        // prior error — cancel the error finalization timer and clear the
        // stale error banner so the user sees the live stream again.
        if (_errorRecoveryTimer) {
          clearErrorRecoveryTimer();
          set({ error: null });
        }
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
        clearErrorRecoveryTimer();
        if (get().error) set({ error: null });
        // Message complete - add to history and clear streaming
        const finalMsg = event.message as RawMessage | undefined;
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
            set((s) => {
              return {
                streamingText: '',
                streamingMessage: null,
                pendingFinal: true,
                pendingToolImages:
                  toolFiles.length > 0
                    ? [...s.pendingToolImages, ...toolFiles]
                    : s.pendingToolImages,
                streamingTools:
                  updates.length > 0
                    ? upsertToolStatuses(s.streamingTools, updates)
                    : s.streamingTools,
              };
            });
            break;
          }
          const toolOnly = isToolOnlyMessage(finalMsg);
          const hasOutput = hasNonToolAssistantContent(finalMsg);
          const shouldRefreshSessionModel = get().pendingSessionModelRefresh;
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
                    pendingSessionModelRefresh: hasOutput ? false : s.pendingSessionModelRefresh,
                    streamingTools,
                    ...clearPendingImages,
                    ...(hasOutput ? resetToolStreamState(s) : {}),
                  };
            }
            return toolOnly
              ? {
                  messages: [...s.messages, msgWithImages],
                  streamingText: '',
                  streamingMessage: null,
                  pendingFinal: true,
                  streamingTools,
                  ...clearPendingImages,
                  ...resetToolStreamState(s),
                }
              : {
                  messages: [...s.messages, msgWithImages],
                  streamingText: '',
                  streamingMessage: null,
                  sending: hasOutput ? false : s.sending,
                  activeRunId: hasOutput ? null : s.activeRunId,
                  pendingFinal: hasOutput ? false : true,
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
            void get().loadHistory(true);
          }
        } else {
          // No message in final event - reload history to get complete data
          const shouldRefreshSessionModel = get().pendingSessionModelRefresh;
          set((s) => ({
            streamingText: '',
            streamingMessage: null,
            pendingFinal: true,
            pendingSessionModelRefresh: false,
            ...resetToolStreamState(s),
          }));
          if (shouldRefreshSessionModel) {
            void get().loadSessions({ preserveCurrent: true, warmLabels: true });
          }
          get().loadHistory();
        }
        break;
      }
      case 'error': {
        const errorMsg = String(event.errorMessage || 'An error occurred');
        const wasSending = get().sending;

        // Snapshot the current streaming message into messages[] so partial
        // content ("Let me get that written down...") is preserved in the UI
        // rather than being silently discarded.
        const currentStream = get().streamingMessage as RawMessage | null;
        if (
          currentStream &&
          (currentStream.role === 'assistant' || currentStream.role === undefined)
        ) {
          const snapId = (currentStream as RawMessage).id || `error-snap-${Date.now()}`;
          const alreadyExists = get().messages.some((m) => m.id === snapId);
          if (!alreadyExists) {
            set((s) => ({
              messages: [
                ...s.messages,
                { ...currentStream, role: 'assistant' as const, id: snapId },
              ],
            }));
          }
        }

        set({
          error: errorMsg,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          pendingSessionModelRefresh: false,
          pendingToolImages: [],
          ...resetToolStreamState(get()),
        });

        // Don't immediately give up: the Gateway often retries internally
        // after transient API failures (e.g. "terminated"). Keep `sending`
        // true for a grace period so that recovery events are processed and
        // the agent-phase-completion handler can still trigger loadHistory.
        if (wasSending) {
          clearErrorRecoveryTimer();
          const ERROR_RECOVERY_GRACE_MS = 15_000;
          _errorRecoveryTimer = setTimeout(() => {
            _errorRecoveryTimer = null;
            const state = get();
            if (state.sending && !state.streamingMessage) {
              clearHistoryPoll();
              // Grace period expired with no recovery — finalize the error
              set({
                sending: false,
                activeRunId: null,
                lastUserMessageAt: null,
                ...resetToolStreamState(state),
              });
              // One final history reload in case the Gateway completed in the
              // background and we just missed the event.
              state.loadHistory(true);
            }
          }, ERROR_RECOVERY_GRACE_MS);
        } else {
          clearHistoryPoll();
          set((s) => ({ sending: false, activeRunId: null, lastUserMessageAt: null, ...resetToolStreamState(s) }));
        }
        break;
      }
      case 'aborted': {
        clearHistoryPoll();
        clearErrorRecoveryTimer();
        set({
          sending: false,
          activeRunId: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          pendingSessionModelRefresh: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
          ...resetToolStreamState(get()),
        });
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

  handleAgentEvent: (event: AgentStreamEvent) => {
    if (!event) return;

    const { currentSessionKey, sessions, activeRunId } = get();
    const eventSessionKey = typeof event.sessionKey === 'string' ? event.sessionKey : '';
    if (eventSessionKey && !sessionKeysMatch(currentSessionKey, eventSessionKey, sessions)) return;

    const incomingRunId = typeof event.runId === 'string' ? event.runId : '';
    if (activeRunId && incomingRunId && incomingRunId !== activeRunId) return;

    if (event.stream === 'compaction') {
      const data = event.data && typeof event.data === 'object' ? event.data : {};
      const phase = typeof data.phase === 'string' ? data.phase : '';
      clearCompactionTimer();
      if (phase === 'start') {
        set({
          compactionStatus: {
            active: true,
            startedAt: Date.now(),
            completedAt: null,
          },
        });
      } else if (phase === 'end') {
        set((s) => ({
          compactionStatus: {
            active: false,
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
      ensureHistoryPollRunning(get);
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
