import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getOpenClawDir, resolveOpenClawDir } from '../../utils/paths';
import { readOpenClawConfigRecordRaw } from '../../utils/openclaw-config';
import { getSetting } from '../../utils/store';
import { proxyAwareFetch } from '../../utils/proxy-fetch';

type SessionHistoryBody = {
  sessionKey?: string;
  limit?: number;
  cursor?: string;
  maxChars?: number;
};

type SessionListBody = {
  limit?: number;
  cursor?: string;
  includeKeys?: string[];
};

type StoredSessionEntry = {
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
  thinkingLevels?: Array<{ id?: string; label?: string }>;
  thinkingDefault?: string;
  fastMode?: boolean;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  execHost?: string;
  execSecurity?: string;
  execAsk?: string;
  execNode?: string;
  queueMode?: string;
  queueDebounceMs?: number;
  queueCap?: number;
  queueDrop?: string;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
  updatedAt?: number;
  runtimeMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  status?: string;
  startedAt?: number;
  endedAt?: number;
};

type StoredSessionDefaults = {
  model?: string;
  modelProvider?: string;
  thinkingLevels?: Array<{ id?: string; label?: string }>;
  thinkingOptions?: string[];
  thinkingDefault?: string;
  verboseDefault?: string;
  reasoningDefault?: string;
  elevatedDefault?: string;
};

type OpenClawSessionEntry = {
  sessionId?: string;
  sessionFile?: string;
};

type OpenClawSessionHelpers = {
  loadSessionEntry: (sessionKey: string) => {
    storePath: string;
    entry?: OpenClawSessionEntry;
  };
  readSessionMessages: (
    sessionId: string,
    storePath: string | undefined,
    sessionFile: string | undefined,
    opts: { mode?: 'recent' | 'all' } & Record<string, unknown>,
  ) => Promise<unknown[]> | unknown[];
  readSessionTitleFieldsFromTranscript: (
    sessionId: string,
    storePath: string | undefined,
    sessionFile?: string,
    agentId?: string,
    opts?: unknown,
  ) => { firstUserMessage: string | null; lastMessagePreview: string | null };
};

const require = createRequire(import.meta.url);
let sessionHelpersPromise: Promise<OpenClawSessionHelpers> | null = null;

const SESSION_LIST_DEFAULT_LIMIT = 30;
const SESSION_LIST_MAX_LIMIT = 100;
const SESSION_LABEL_MAX_LENGTH = 50;
const SESSION_HISTORY_MAX_LIMIT = 200;
const SESSION_HISTORY_GATEWAY_TIMEOUT_MS = 2_000;

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

function encodeSessionListCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeSessionListCursor(cursor: unknown): number {
  if (typeof cursor !== 'string' || !cursor.trim()) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: unknown;
    };
    const offset = typeof parsed.offset === 'number' ? Math.trunc(parsed.offset) : 0;
    return Number.isFinite(offset) && offset > 0 ? offset : 0;
  } catch {
    return 0;
  }
}

function encodeSessionHistoryCursor(endIndex: number): string {
  return Buffer.from(JSON.stringify({ endIndex }), 'utf8').toString('base64url');
}

function decodeSessionHistoryCursor(cursor: unknown): number | null {
  if (typeof cursor !== 'string' || !cursor.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      endIndex?: unknown;
    };
    const endIndex = typeof parsed.endIndex === 'number' ? Math.trunc(parsed.endIndex) : NaN;
    return Number.isFinite(endIndex) && endIndex >= 0 ? endIndex : null;
  } catch {
    return null;
  }
}

function readStoredSessionEntries(): StoredSessionEntry[] {
  const agentsDir = path.join(resolveOpenClawDir(), 'agents');
  let agentIds: string[];
  try {
    agentIds = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const sessions: StoredSessionEntry[] = [];

  for (const agentId of agentIds) {
    const storePath = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
    if (!fs.existsSync(storePath)) continue;

    try {
      const raw = fs.readFileSync(storePath, 'utf8').trim();
      if (!raw) continue;

      const parsed = JSON.parse(raw) as Record<string, unknown> | { sessions?: unknown[] };
      const keyedEntries = Array.isArray((parsed as { sessions?: unknown[] }).sessions)
        ? ((parsed as { sessions?: unknown[] }).sessions ?? [])
            .map((value) => {
              if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
              const record = value as Record<string, unknown>;
              const keyValue = record.key ?? record.sessionKey;
              return typeof keyValue === 'string' ? [keyValue, record] as const : null;
            })
            .filter((value): value is readonly [string, Record<string, unknown>] => Boolean(value))
        : Object.entries(parsed).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value));

      for (const [entryKey, value] of keyedEntries) {
        const key = typeof entryKey === 'string' ? entryKey.trim() : '';
        if (!key.startsWith('agent:') || key.includes(':cron:')) continue;

        const record = value as Record<string, unknown>;
        const updatedAtRaw = record.updatedAt;
        const updatedAt = typeof updatedAtRaw === 'number'
          ? updatedAtRaw
          : typeof updatedAtRaw === 'string'
            ? Number(updatedAtRaw)
            : undefined;
        const contextTokensRaw = record.contextTokens;
        const contextTokens = typeof contextTokensRaw === 'number'
          ? contextTokensRaw
          : typeof contextTokensRaw === 'string'
            ? Number(contextTokensRaw)
            : undefined;
        const thinkingOptions = Array.isArray(record.thinkingOptions)
          ? record.thinkingOptions
              .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          : undefined;
        const thinkingLevels = Array.isArray(record.thinkingLevels)
          ? record.thinkingLevels
              .flatMap((value) => {
                if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
                const option = value as Record<string, unknown>;
                const id = typeof option.id === 'string' ? option.id : undefined;
                const label = typeof option.label === 'string' ? option.label : undefined;
                return id || label ? [{ id, label }] : [];
              })
          : undefined;

        sessions.push({
          key,
          label: typeof record.label === 'string' ? record.label : undefined,
          displayName: typeof record.displayName === 'string'
            ? record.displayName
            : typeof record.origin === 'object' && record.origin && typeof (record.origin as Record<string, unknown>).label === 'string'
              ? String((record.origin as Record<string, unknown>).label)
              : undefined,
          derivedTitle: typeof record.derivedTitle === 'string' ? record.derivedTitle : undefined,
          lastMessagePreview: typeof record.lastMessagePreview === 'string' ? record.lastMessagePreview : undefined,
          kind: typeof record.kind === 'string' ? record.kind : undefined,
          spawnedBy: typeof record.spawnedBy === 'string' ? record.spawnedBy : undefined,
          parentSessionKey: typeof record.parentSessionKey === 'string' ? record.parentSessionKey : undefined,
          forkedFromParent: record.forkedFromParent === true,
          subagentRole: typeof record.subagentRole === 'string' ? record.subagentRole : undefined,
          thinkingLevel: typeof record.thinkingLevel === 'string' ? record.thinkingLevel : undefined,
          thinkingOptions: thinkingOptions?.length ? thinkingOptions : undefined,
          thinkingLevels: thinkingLevels?.length ? thinkingLevels : undefined,
          thinkingDefault: typeof record.thinkingDefault === 'string' ? record.thinkingDefault : undefined,
          fastMode: typeof record.fastMode === 'boolean' ? record.fastMode : undefined,
          verboseLevel: typeof record.verboseLevel === 'string' ? record.verboseLevel : undefined,
          reasoningLevel: typeof record.reasoningLevel === 'string' ? record.reasoningLevel : undefined,
          elevatedLevel: typeof record.elevatedLevel === 'string' ? record.elevatedLevel : undefined,
          execHost: typeof record.execHost === 'string' ? record.execHost : undefined,
          execSecurity: typeof record.execSecurity === 'string' ? record.execSecurity : undefined,
          execAsk: typeof record.execAsk === 'string' ? record.execAsk : undefined,
          execNode: typeof record.execNode === 'string' ? record.execNode : undefined,
          queueMode: typeof record.queueMode === 'string' ? record.queueMode : undefined,
          queueDebounceMs: Number.isFinite(record.queueDebounceMs as number) ? (record.queueDebounceMs as number) : undefined,
          queueCap: Number.isFinite(record.queueCap as number) ? (record.queueCap as number) : undefined,
          queueDrop: typeof record.queueDrop === 'string' ? record.queueDrop : undefined,
          model: typeof record.model === 'string' ? record.model : undefined,
          modelProvider: typeof record.modelProvider === 'string'
            ? record.modelProvider
            : typeof record.provider === 'string'
              ? record.provider
              : undefined,
          contextTokens: Number.isFinite(contextTokens) ? contextTokens : undefined,
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
          runtimeMs: Number.isFinite(record.runtimeMs as number) ? (record.runtimeMs as number) : undefined,
          inputTokens: Number.isFinite(record.inputTokens as number) ? (record.inputTokens as number) : undefined,
          outputTokens: Number.isFinite(record.outputTokens as number) ? (record.outputTokens as number) : undefined,
          totalTokens: Number.isFinite(record.totalTokens as number) ? (record.totalTokens as number) : undefined,
          status: typeof record.status === 'string' ? record.status : undefined,
          startedAt: Number.isFinite(record.startedAt as number) ? (record.startedAt as number) : undefined,
          endedAt: Number.isFinite(record.endedAt as number) ? (record.endedAt as number) : undefined,
        });
      }
    } catch {
      // Ignore malformed session stores for pagination purposes.
    }
  }

  sessions.sort((left, right) => {
    const rightUpdated = right.updatedAt ?? 0;
    const leftUpdated = left.updatedAt ?? 0;
    if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;
    return right.key.localeCompare(left.key);
  });

  return sessions;
}

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

function truncateSessionLabel(text: string): string {
  return text.length > SESSION_LABEL_MAX_LENGTH ? `${text.slice(0, SESSION_LABEL_MAX_LENGTH)}…` : text;
}

function getAgentIdFromSessionKey(sessionKey: string): string | undefined {
  const trimmed = sessionKey.trim();
  if (!trimmed.startsWith('agent:')) return undefined;
  return trimmed.split(':')[1]?.trim() || undefined;
}

function parseModelRef(ref?: string | null): { provider?: string; model?: string } {
  const trimmed = ref?.trim();
  if (!trimmed) return {};
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return { model: trimmed };
  return {
    provider: trimmed.slice(0, slashIndex),
    model: trimmed.slice(slashIndex + 1),
  };
}

async function readStoredSessionDefaults(): Promise<StoredSessionDefaults | null> {
  try {
    const config = await readOpenClawConfigRecordRaw<Record<string, unknown>>();
    const agents = config.agents;
    const defaults = agents && typeof agents === 'object' && !Array.isArray(agents)
      ? (agents as Record<string, unknown>).defaults
      : undefined;
    const defaultsRecord = defaults && typeof defaults === 'object' && !Array.isArray(defaults)
      ? defaults as Record<string, unknown>
      : null;
    if (!defaultsRecord) return null;

    const modelField = defaultsRecord.model;
    const primaryModel = typeof modelField === 'string'
      ? modelField.trim()
      : modelField && typeof modelField === 'object' && !Array.isArray(modelField)
        && typeof (modelField as Record<string, unknown>).primary === 'string'
        ? String((modelField as Record<string, unknown>).primary).trim()
        : '';
    const parsedModel = parseModelRef(primaryModel);
    const thinkingOptions = Array.isArray(defaultsRecord.thinkingOptions)
      ? defaultsRecord.thinkingOptions
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : undefined;
    const thinkingLevels = Array.isArray(defaultsRecord.thinkingLevels)
      ? defaultsRecord.thinkingLevels
          .flatMap((value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
            const option = value as Record<string, unknown>;
            const id = typeof option.id === 'string' ? option.id : undefined;
            const label = typeof option.label === 'string' ? option.label : undefined;
            return id || label ? [{ id, label }] : [];
          })
      : undefined;
    const thinkingDefault = typeof defaultsRecord.thinkingDefault === 'string'
      ? defaultsRecord.thinkingDefault
      : undefined;
    const verboseDefault = typeof defaultsRecord.verboseDefault === 'string'
      ? defaultsRecord.verboseDefault
      : undefined;
    const reasoningDefault = typeof defaultsRecord.reasoningDefault === 'string'
      ? defaultsRecord.reasoningDefault
      : undefined;
    const elevatedDefault = typeof defaultsRecord.elevatedDefault === 'string'
      ? defaultsRecord.elevatedDefault
      : undefined;

    if (
      !primaryModel
      && !thinkingDefault
      && !thinkingOptions?.length
      && !thinkingLevels?.length
      && !verboseDefault
      && !reasoningDefault
      && !elevatedDefault
    ) {
      return null;
    }

    return {
      model: primaryModel || undefined,
      modelProvider: parsedModel.provider,
      thinkingOptions: thinkingOptions?.length ? thinkingOptions : undefined,
      thinkingLevels: thinkingLevels?.length ? thinkingLevels : undefined,
      thinkingDefault,
      verboseDefault,
      reasoningDefault,
      elevatedDefault,
    };
  } catch {
    return null;
  }
}

async function enrichPagedSessions(
  sessions: StoredSessionEntry[],
): Promise<StoredSessionEntry[]> {
  const needsEnrichment = sessions.filter((session) => !session.derivedTitle && !session.label);
  if (needsEnrichment.length === 0) {
    return sessions;
  }

  const helpers = await loadOpenClawSessionHelpers();
  const enrichedByKey = new Map<string, Partial<StoredSessionEntry>>();

  await Promise.all(needsEnrichment.map(async (session) => {
    try {
      const { storePath, entry } = helpers.loadSessionEntry(session.key);
      const sessionId = typeof entry?.sessionId === 'string' ? entry.sessionId.trim() : '';
      if (!sessionId) return;

      const titleFields = helpers.readSessionTitleFieldsFromTranscript(
        sessionId,
        storePath,
        entry?.sessionFile,
        getAgentIdFromSessionKey(session.key),
      );
      const derivedTitle = normalizeSessionTitleCandidate(titleFields.firstUserMessage ?? '');
      const lastMessagePreview = normalizeSessionTitleCandidate(titleFields.lastMessagePreview ?? '');
      if (!derivedTitle && !lastMessagePreview) return;

      enrichedByKey.set(session.key, {
        ...(derivedTitle ? { derivedTitle: truncateSessionLabel(derivedTitle) } : {}),
        ...(lastMessagePreview ? { lastMessagePreview: lastMessagePreview.length > 140 ? `${lastMessagePreview.slice(0, 140)}…` : lastMessagePreview } : {}),
      });
    } catch {
      // Best-effort enrichment only; fall back to the stored session row.
    }
  }));

  if (enrichedByKey.size === 0) {
    return sessions;
  }

  return sessions.map((session) => {
    const enriched = enrichedByKey.get(session.key);
    return enriched ? { ...session, ...enriched } : session;
  });
}

const RECENT_TRANSCRIPT_INITIAL_READ_BYTES = 512_000;
const RECENT_TRANSCRIPT_MAX_READ_BYTES = 10 * 1024 * 1024;
const LEADING_TRANSCRIPT_READ_BYTES = 256_000;

interface TranscriptMessage {
  role?: string;
  content?: unknown;
  timestamp?: string;
  id?: string;
}

type LocalSessionFileEntry = {
  sessionId?: string;
  sessionFile?: string;
};

function readRecentTranscriptMessages(transcriptPath: string, limit: number): TranscriptMessage[] {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 1000));
  let fd: number | null = null;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size === 0) return [];

    let readBytes = Math.min(size, Math.max(RECENT_TRANSCRIPT_INITIAL_READ_BYTES, boundedLimit * 2048));
    while (readBytes <= size) {
      const readStart = Math.max(0, size - readBytes);
      const readLen = size - readStart;
      const buffer = Buffer.allocUnsafe(readLen);
      fs.readSync(fd, buffer, 0, readLen, readStart);
      const messages = parseRecentMessagesFromTailChunk(buffer.toString('utf8'), readStart, boundedLimit);
      if (
        messages.length >= boundedLimit
        || readStart === 0
        || readBytes >= RECENT_TRANSCRIPT_MAX_READ_BYTES
      ) {
        return messages;
      }
      readBytes = Math.min(size, readBytes * 2);
    }
    return [];
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function readLeadingTranscriptMessages(transcriptPath: string, limit: number): TranscriptMessage[] {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 1000));
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size === 0) return [];
      const readLen = Math.min(size, LEADING_TRANSCRIPT_READ_BYTES);
      const buffer = Buffer.allocUnsafe(readLen);
      fs.readSync(fd, buffer, 0, readLen, 0);
      const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
      const result: TranscriptMessage[] = [];
      for (const line of lines) {
        if (result.length >= boundedLimit) break;
        try {
          const parsed = JSON.parse(line) as TranscriptMessage;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            result.push(parsed);
          }
        } catch {
          // Skip a potentially truncated trailing line in the first chunk.
        }
      }
      return result;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

function parseRecentMessagesFromTailChunk(
  chunk: string,
  byteOffset: number,
  limit: number,
): TranscriptMessage[] {
  const lines = chunk.split(/\r?\n/).filter(Boolean);
  const result: TranscriptMessage[] = [];
  for (let i = lines.length - 1; i >= 0 && result.length < limit; i--) {
    try {
      const msg = JSON.parse(lines[i]) as TranscriptMessage;
      if (msg && typeof msg === 'object' && !Array.isArray(msg)) result.unshift(msg);
    } catch {
      // skip malformed lines
    }
  }
  return result;
}

function readAllTranscriptMessages(transcriptPath: string): TranscriptMessage[] {
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    if (!raw.trim()) return [];
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as TranscriptMessage;
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? [parsed]
            : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function resolveLocalSessionsStorePath(sessionKey: string): string | null {
  const agentId = getAgentIdFromSessionKey(sessionKey);
  if (!agentId) return null;
  const storePath = path.join(resolveOpenClawDir(), 'agents', agentId, 'sessions', 'sessions.json');
  return fs.existsSync(storePath) ? storePath : null;
}

function findLocalSessionFileEntryByKey(sessionKey: string): LocalSessionFileEntry | null {
  const sessionsJson = resolveLocalSessionsStorePath(sessionKey);
  if (!sessionsJson) return null;

  try {
    const raw = fs.readFileSync(sessionsJson, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown> | { sessions?: unknown[] };

    const fromRecord = (record: Record<string, unknown>): LocalSessionFileEntry => ({
      sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
      sessionFile: typeof record.sessionFile === 'string' ? record.sessionFile : undefined,
    });

    if (Array.isArray((parsed as { sessions?: unknown[] }).sessions)) {
      const entries = (parsed as { sessions?: unknown[] }).sessions ?? [];
      const match = entries.find((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const record = value as Record<string, unknown>;
        const keyValue = record.key ?? record.sessionKey;
        return typeof keyValue === 'string' && keyValue.trim() === sessionKey;
      });
      return match && typeof match === 'object' && !Array.isArray(match)
        ? fromRecord(match as Record<string, unknown>)
        : null;
    }

    const keyed = parsed as Record<string, unknown>;
    const direct = keyed[sessionKey];
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return fromRecord(direct as Record<string, unknown>);
    }
    return null;
  } catch {
    return null;
  }
}

function resolveTranscriptPathFromSessionKey(sessionKey: string): string | null {
  const entry = findLocalSessionFileEntryByKey(sessionKey);
  const candidate = entry?.sessionFile?.trim();
  if (!candidate) return null;
  if (path.isAbsolute(candidate)) {
    return fs.existsSync(candidate) ? candidate : null;
  }

  const sessionsJson = resolveLocalSessionsStorePath(sessionKey);
  if (!sessionsJson) return null;
  const transcriptPath = path.join(path.dirname(sessionsJson), candidate);
  return fs.existsSync(transcriptPath) ? transcriptPath : null;
}

async function loadSessionTranscriptByKey(
  sessionKey: string,
  limit: number,
  mode: 'recent' | 'head' = 'recent',
): Promise<TranscriptMessage[] | null> {
  const transcriptPath = resolveTranscriptPathFromSessionKey(sessionKey);
  if (!transcriptPath) return null;
  return mode === 'head'
    ? readLeadingTranscriptMessages(transcriptPath, limit)
    : readRecentTranscriptMessages(transcriptPath, limit);
}

function normalizeHistoryMessage(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }
  const rawRecord = message as Record<string, unknown>;
  const record = (
    rawRecord.type === 'message'
    && rawRecord.message
    && typeof rawRecord.message === 'object'
    && !Array.isArray(rawRecord.message)
  )
    ? { ...(rawRecord.message as Record<string, unknown>) }
    : { ...rawRecord };
  const openclawMeta =
    rawRecord.__openclaw && typeof rawRecord.__openclaw === 'object' && !Array.isArray(rawRecord.__openclaw)
      ? (rawRecord.__openclaw as Record<string, unknown>)
      : record.__openclaw && typeof record.__openclaw === 'object' && !Array.isArray(record.__openclaw)
        ? (record.__openclaw as Record<string, unknown>)
      : null;
  if (openclawMeta && !record.__openclaw) {
    record.__openclaw = openclawMeta;
  }
  if (typeof record.role !== 'string') {
    return null;
  }
  if (record.role === 'system' && openclawMeta?.kind === 'compaction') {
    record.role = 'compactionSummary';
  }
  return record;
}

function findExportByFunctionName<T extends (...args: never[]) => unknown>(
  mod: Record<string, unknown>,
  candidates: readonly string[],
): T {
  for (const key of Object.keys(mod)) {
    const value = mod[key];
    if (typeof value !== 'function') continue;
    if (candidates.includes((value as { name?: string }).name ?? '')) {
      return value as T;
    }
  }
  throw new Error(
    `OpenClaw session utils export not found (tried: ${candidates.join(', ')})`,
  );
}

async function loadOpenClawSessionHelpers(): Promise<OpenClawSessionHelpers> {
  if (!sessionHelpersPromise) {
    sessionHelpersPromise = (async () => {
      let distDir = path.join(getOpenClawDir(), 'dist');
      if (!fs.existsSync(distDir)) {
        const openclawEntry = require.resolve('openclaw');
        distDir = path.dirname(openclawEntry);
      }
      const names = fs.readdirSync(distDir);
      const sessionUtilsFile = names.find((name) => name.startsWith('session-utils-') && name.endsWith('.js'));
      if (!sessionUtilsFile) {
        throw new Error('Unable to locate OpenClaw session utils module');
      }
      const fsSessionUtilsFile = names.find((name) => name.startsWith('session-utils.fs-') && name.endsWith('.js'));
      if (!fsSessionUtilsFile) {
        throw new Error('Unable to locate OpenClaw session utils fs module');
      }
      const moduleUrl = pathToFileURL(path.join(distDir, sessionUtilsFile)).href;
      const fsModuleUrl = pathToFileURL(path.join(distDir, fsSessionUtilsFile)).href;
      const mod = await import(moduleUrl) as Record<string, unknown>;
      const fsMod = await import(fsModuleUrl) as Record<string, unknown>;

      // The OpenClaw bundle's exports are minified to single-letter keys whose
      // indices drift between versions, so resolve them by `.name` instead.
      // `readSessionMessages` is only exported in an async-suffixed form in
      // recent OpenClaw releases; older releases exposed a synchronous variant
      // under the same logical role.
      const loadSessionEntry = findExportByFunctionName<OpenClawSessionHelpers['loadSessionEntry']>(
        mod,
        ['loadSessionEntry'],
      );
      const readSessionTitleFieldsFromTranscript = findExportByFunctionName<
        OpenClawSessionHelpers['readSessionTitleFieldsFromTranscript']
      >(fsMod, ['readSessionTitleFieldsFromTranscript']);
      const readSessionMessages = findExportByFunctionName<
        OpenClawSessionHelpers['readSessionMessages']
      >(fsMod, ['readSessionMessagesAsync', 'readSessionMessages']);

      return {
        readSessionMessages,
        readSessionTitleFieldsFromTranscript,
        loadSessionEntry,
      };
    })();
  }
  return sessionHelpersPromise;
}

export async function handleSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/sessions/list' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<SessionListBody>(req);
      const requestedLimit = typeof body.limit === 'number' ? Math.trunc(body.limit) : SESSION_LIST_DEFAULT_LIMIT;
      const limit = Math.min(Math.max(requestedLimit, 1), SESSION_LIST_MAX_LIMIT);
      const includeKeys = Array.isArray(body.includeKeys)
        ? body.includeKeys.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
      const offset = decodeSessionListCursor(body.cursor);
      const allSessions = readStoredSessionEntries();
      const pageSessions = allSessions.slice(offset, offset + limit);
      const pinnedSessions = includeKeys
        .map((key) => allSessions.find((session) => session.key === key))
        .filter((session): session is StoredSessionEntry => Boolean(session))
        .filter((session) => !pageSessions.some((pageSession) => pageSession.key === session.key));
      const sessions = await enrichPagedSessions([...pinnedSessions, ...pageSessions]);
      const defaults = await readStoredSessionDefaults();
      const nextOffset = offset + pageSessions.length;
      const hasMore = nextOffset < allSessions.length;

      sendJson(res, 200, {
        success: true,
        sessions,
        defaults,
        total: allSessions.length,
        hasMore,
        nextCursor: hasMore ? encodeSessionListCursor(nextOffset) : null,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sessions/delete' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string }>(req);
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
      if (!sessionKey) {
        sendJson(res, 400, { success: false, error: 'sessionKey is required' });
        return true;
      }
      const result = await ctx.gatewayManager.rpc('sessions.delete', {
        key: sessionKey,
        deleteTranscript: true,
      });
      sendJson(res, 200, { success: true, result });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // GET /api/sessions/transcript — local JSONL transcript for history hydration.
  if (url.pathname === '/api/sessions/transcript' && req.method === 'GET') {
    const sessionKey = url.searchParams.get('sessionKey')?.trim() || '';
    const limitRaw = Number(url.searchParams.get('limit') ?? '200');
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : 200;
    const mode = url.searchParams.get('mode') === 'head' ? 'head' : 'recent';

    if (!sessionKey) {
      sendJson(res, 400, { success: false, error: 'sessionKey is required' });
      return true;
    }

    const messages = await loadSessionTranscriptByKey(sessionKey, limit, mode);
    if (!messages || messages.length === 0) {
      sendJson(res, 404, { success: false, error: 'Transcript not found' });
      return true;
    }

    const normalized = messages
      .map((m) => normalizeHistoryMessage(m))
      .filter((m): m is Record<string, unknown> => m !== null);
    sendJson(res, 200, { success: true, messages: normalized });
    return true;
  }

  if (url.pathname === '/api/sessions/history' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<SessionHistoryBody>(req);
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
      if (!sessionKey) {
        sendJson(res, 400, { success: false, error: 'sessionKey is required' });
        return true;
      }

      const pageLimit = Math.min(
        Math.max(typeof body.limit === 'number' ? Math.trunc(body.limit) : SESSION_HISTORY_MAX_LIMIT, 1),
        SESSION_HISTORY_MAX_LIMIT,
      );
      const requestedCursor = typeof body.cursor === 'string' && body.cursor.trim()
        ? body.cursor.trim()
        : null;
      const requestedMaxChars = typeof body.maxChars === 'number' && body.maxChars > 0
        ? Math.min(Math.trunc(body.maxChars), 10_000_000)
        : null;

      const gatewayStatus = ctx.gatewayManager.getStatus();
      const gatewayPort = gatewayStatus.port || 18789;
      const gatewayToken = await getSetting('gatewayToken');
      // Prefer local transcript pagination while the Gateway is still settling
      // after startup/reconnect. This avoids piling 2-5s history requests onto
      // a control-plane that is technically "running" but not yet responsive.
      const shouldTryGateway =
        gatewayStatus.state === 'running'
        && gatewayStatus.transportReady === true
        && gatewayStatus.fullReady === true
        && gatewayStatus.runtimeHealthy !== false
        && !ctx.gatewayManager.isInStartupStabilizationWindow(15_000);

      if (shouldTryGateway && gatewayToken) {
        try {
          const upstream = new URL(
            `http://127.0.0.1:${gatewayPort}/sessions/${encodeURIComponent(sessionKey)}/history`,
          );
          upstream.searchParams.set('limit', String(pageLimit));
          if (requestedCursor) {
            upstream.searchParams.set('cursor', requestedCursor);
          }
          if (requestedMaxChars) {
            upstream.searchParams.set('maxChars', String(requestedMaxChars));
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort(new Error(`Gateway session history timed out after ${SESSION_HISTORY_GATEWAY_TIMEOUT_MS}ms`));
          }, SESSION_HISTORY_GATEWAY_TIMEOUT_MS);
          const response = await proxyAwareFetch(upstream, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${gatewayToken}`,
            },
            signal: controller.signal,
          }).finally(() => {
            clearTimeout(timeoutId);
          });
          if (response.ok) {
            const payload = await response.json().catch(() => null) as
              | {
                sessionKey?: string;
                messages?: unknown[];
                hasMore?: boolean;
                nextCursor?: string | null;
              }
              | null;
            if (payload && Array.isArray(payload.messages)) {
              sendJson(res, 200, {
                success: true,
                sessionKey: payload.sessionKey ?? sessionKey,
                messages: payload.messages
                  .map((message) => normalizeHistoryMessage(message))
                  .filter((message): message is Record<string, unknown> => Boolean(message)),
                hasMore: payload.hasMore === true,
                nextCursor:
                  typeof payload.nextCursor === 'string' && payload.nextCursor.trim()
                    ? payload.nextCursor
                    : null,
              });
              return true;
            }
          }
        } catch {
          // Fall back to local transcript pagination below.
        }
      }

      const transcriptPath = resolveTranscriptPathFromSessionKey(sessionKey);
      if (!transcriptPath) {
        sendJson(res, 404, { success: false, error: 'Session transcript not found' });
        return true;
      }

      const rawMessages = readAllTranscriptMessages(transcriptPath);
      const normalizedMessages = rawMessages
        .map((message) => normalizeHistoryMessage(message))
        .filter((message): message is Record<string, unknown> => Boolean(message));

      let endIndex = normalizedMessages.length;
      if (requestedCursor) {
        const decodedCursor = decodeSessionHistoryCursor(requestedCursor);
        if (decodedCursor != null) {
          endIndex = Math.max(0, Math.min(decodedCursor, normalizedMessages.length));
        }
      }

      const startIndex = Math.max(0, endIndex - pageLimit);
      sendJson(res, 200, {
        success: true,
        sessionKey,
        messages: normalizedMessages.slice(startIndex, endIndex),
        hasMore: startIndex > 0,
        nextCursor: startIndex > 0 ? encodeSessionHistoryCursor(startIndex) : null,
        total: normalizedMessages.length,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
