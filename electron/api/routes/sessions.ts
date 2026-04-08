import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

type SessionHistoryBody = {
  sessionKey?: string;
  limit?: number;
  before?: {
    role?: string;
    timestamp?: number;
    id?: string;
    toolCallId?: string;
  };
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
  const timestamp = typeof message.timestamp === 'number' ? message.timestamp : null;
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
      const openclawEntry = require.resolve('openclaw');
      const distDir = path.dirname(openclawEntry);
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
