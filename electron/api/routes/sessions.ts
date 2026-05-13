import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getOpenClawDir, resolveOpenClawDir } from '../../utils/paths';
import { normalizeChatTimestampForKey, type ChatTimestamp } from '../../../src/lib/chat-timestamps';

type SessionHistoryBody = {
  sessionKey?: string;
  limit?: number;
  before?: {
    role?: string;
    timestamp?: ChatTimestamp;
    id?: string;
    toolCallId?: string;
  };
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
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
  updatedAt?: number;
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
    sessionFile?: string,
  ) => unknown[];
};

const require = createRequire(import.meta.url);
let sessionHelpersPromise: Promise<OpenClawSessionHelpers> | null = null;

const SESSION_LIST_DEFAULT_LIMIT = 30;
const SESSION_LIST_MAX_LIMIT = 100;

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

function readStoredSessionEntries(): StoredSessionEntry[] {
  const agentsDir = path.join(resolveOpenClawDir(), 'agents');
  let agentIds: string[] = [];
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
          model: typeof record.model === 'string' ? record.model : undefined,
          modelProvider: typeof record.modelProvider === 'string'
            ? record.modelProvider
            : typeof record.provider === 'string'
              ? record.provider
              : undefined,
          contextTokens: Number.isFinite(contextTokens) ? contextTokens : undefined,
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
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

function resolveHistoryMessageKey(message: {
  role?: unknown;
  timestamp?: unknown;
  id?: unknown;
  toolCallId?: unknown;
  tool_call_id?: unknown;
}): string {
  const toolCallId =
    typeof message.toolCallId === 'string'
      ? message.toolCallId
      : (typeof message.tool_call_id === 'string' ? message.tool_call_id : '');
  if (toolCallId) return `tool:${toolCallId}`;

  const id = typeof message.id === 'string' ? message.id : '';
  if (id) return `msg:${id}`;

  const role = typeof message.role === 'string' ? message.role : 'unknown';
  const timestamp = normalizeChatTimestampForKey(message.timestamp);
  if (timestamp != null) return `msg:${role}:${timestamp}`;
  return `msg:${role}`;
}

function normalizeHistoryMessage(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }
  const record = { ...(message as Record<string, unknown>) };
  const openclawMeta =
    record.__openclaw && typeof record.__openclaw === 'object' && !Array.isArray(record.__openclaw)
      ? (record.__openclaw as Record<string, unknown>)
      : null;
  if (record.role === 'system' && openclawMeta?.kind === 'compaction') {
    record.role = 'compactionSummary';
  }
  return record;
}

async function loadOpenClawSessionHelpers(): Promise<OpenClawSessionHelpers> {
  if (!sessionHelpersPromise) {
    sessionHelpersPromise = (async () => {
      let distDir = path.join(getOpenClawDir(), 'dist');
      if (!fs.existsSync(distDir)) {
        const openclawEntry = require.resolve('openclaw');
        distDir = path.dirname(openclawEntry);
      }
      const sessionUtilsFile = fs
        .readdirSync(distDir)
        .find((name) => name.startsWith('session-utils-') && name.endsWith('.js'));
      if (!sessionUtilsFile) {
        throw new Error('Unable to locate OpenClaw session utils module');
      }
      const moduleUrl = pathToFileURL(path.join(distDir, sessionUtilsFile)).href;
      const mod = await import(moduleUrl) as {
        _: OpenClawSessionHelpers['readSessionMessages'];
        s: OpenClawSessionHelpers['loadSessionEntry'];
      };
      return {
        readSessionMessages: mod._,
        loadSessionEntry: mod.s,
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
      const nextOffset = offset + pageSessions.length;
      const hasMore = nextOffset < allSessions.length;

      sendJson(res, 200, {
        success: true,
        sessions: [...pinnedSessions, ...pageSessions],
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

  if (url.pathname === '/api/sessions/history' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<SessionHistoryBody>(req);
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
      if (!sessionKey) {
        sendJson(res, 400, { success: false, error: 'sessionKey is required' });
        return true;
      }

      const pageLimit = Math.min(
        Math.max(typeof body.limit === 'number' ? Math.trunc(body.limit) : 200, 1),
        200,
      );
      const beforeKey = body.before ? resolveHistoryMessageKey(body.before) : null;

      const helpers = await loadOpenClawSessionHelpers();
      const { storePath, entry } = helpers.loadSessionEntry(sessionKey);
      const sessionId = typeof entry?.sessionId === 'string' ? entry.sessionId.trim() : '';
      if (!sessionId) {
        sendJson(res, 404, { success: false, error: 'Session transcript not found' });
        return true;
      }

      const normalizedMessages = helpers
        .readSessionMessages(sessionId, storePath, entry?.sessionFile)
        .map((message) => normalizeHistoryMessage(message))
        .filter((message): message is Record<string, unknown> => Boolean(message));

      let endIndex = normalizedMessages.length;
      let anchorFound = false;
      if (beforeKey) {
        const anchorIndex = normalizedMessages.findIndex(
          (message) => resolveHistoryMessageKey(message) === beforeKey,
        );
        if (anchorIndex >= 0) {
          endIndex = anchorIndex;
          anchorFound = true;
        }
      }

      const startIndex = Math.max(0, endIndex - pageLimit);
      sendJson(res, 200, {
        success: true,
        messages: normalizedMessages.slice(startIndex, endIndex),
        hasMore: startIndex > 0,
        total: normalizedMessages.length,
        anchorFound: beforeKey ? anchorFound : true,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
