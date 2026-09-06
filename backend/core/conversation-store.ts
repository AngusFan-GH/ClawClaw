/**
 * Conversation and immutable message ledger.
 *
 * Messages are ordered by a per-conversation monotonic `seq` assigned inside a
 * transaction, which gives the renderer stable cursor pagination and the
 * summarizer an exact source range.
 */
import type { CoreDatabase } from './db/database';
import type { ConversationMessage, MessageRole } from './contracts';
import { isoNow, newId } from './util';

export interface AppendMessageInput {
  role: MessageRole;
  content: string;
  runId?: string | null;
  metadata?: Record<string, unknown> | null;
  artifactIds?: string[];
  createdAt?: string;
}

interface MessageRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  run_id: string | null;
  seq: number;
  role: MessageRole;
  content: string;
  metadata_json: string | null;
  created_at: string;
}

export interface ConversationSummaryRow {
  id: string;
  title: string;
  updatedAt: string;
  lastMessagePreview: string;
  messageCount: number;
}

export class ConversationStore {
  constructor(private readonly ctx: CoreDatabase) {}

  private get db() {
    return this.ctx.db;
  }

  ensure(workspaceId: string, conversationId: string, title = ''): void {
    const ts = isoNow();
    this.db
      .prepare(`INSERT INTO core_conversation (id,workspace_id,title,created_at,updated_at)
        VALUES (?,?,?,?,?) ON CONFLICT(workspace_id,id) DO NOTHING`)
      .run(conversationId, workspaceId, title, ts, ts);
  }

  exists(workspaceId: string, conversationId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM core_conversation WHERE workspace_id=? AND id=?').get(workspaceId, conversationId));
  }

  append(workspaceId: string, conversationId: string, input: AppendMessageInput): ConversationMessage {
    this.ensure(workspaceId, conversationId);
    return this.ctx.transaction(() => {
      const next = (this.maxSeq(workspaceId, conversationId) ?? 0) + 1;
      const id = newId();
      const createdAt = input.createdAt ?? isoNow();
      const metadata = { ...(input.metadata ?? {}), ...(input.artifactIds?.length ? { artifactIds: input.artifactIds } : {}) };
      this.db
        .prepare(`INSERT INTO core_message (id,workspace_id,conversation_id,run_id,seq,role,content,metadata_json,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, workspaceId, conversationId, input.runId ?? null, next, input.role, input.content,
          Object.keys(metadata).length ? JSON.stringify(metadata) : null, createdAt);
      this.db.prepare('UPDATE core_conversation SET updated_at=? WHERE workspace_id=? AND id=?').run(createdAt, workspaceId, conversationId);
      // Default title from the first user message.
      const title = this.db.prepare('SELECT title FROM core_conversation WHERE workspace_id=? AND id=?').get(workspaceId, conversationId) as unknown as { title: string };
      if (!title.title && input.role === 'user') {
        this.db.prepare('UPDATE core_conversation SET title=? WHERE workspace_id=? AND id=?')
          .run(input.content.slice(0, 60), workspaceId, conversationId);
      }
      return this.toMessage(this.db.prepare('SELECT * FROM core_message WHERE id=?').get(id) as unknown as MessageRow);
    });
  }

  /** Associate artifacts with the latest message (or an explicit one). */
  linkArtifacts(workspaceId: string, conversationId: string, messageId: string | null, artifactIds: string[]): void {
    const ts = isoNow();
    const stmt = this.db.prepare('INSERT INTO core_artifact_link (id,workspace_id,conversation_id,message_id,artifact_id,created_at) VALUES (?,?,?,?,?,?)');
    for (const artifactId of artifactIds) void stmt.run(newId(), workspaceId, conversationId, messageId, artifactId, ts);
  }

  maxSeq(workspaceId: string, conversationId: string): number | undefined {
    const row = this.db.prepare('SELECT MAX(seq) m FROM core_message WHERE workspace_id=? AND conversation_id=?').get(workspaceId, conversationId) as unknown as { m: number | null };
    return row.m ?? undefined;
  }

  /** Cursor pagination: returns messages strictly before `beforeSeq` (newest first window). */
  page(workspaceId: string, conversationId: string, opts: { beforeSeq?: number; limit?: number } = {}): {
    messages: ConversationMessage[];
    oldestSeq: number | undefined;
    hasMore: boolean;
  } {
    const limit = Math.min(opts.limit ?? 50, 200);
    const before = opts.beforeSeq ?? Number.MAX_SAFE_INTEGER;
    const rows = (this.db
      .prepare(`SELECT * FROM core_message WHERE workspace_id=? AND conversation_id=? AND seq < ? ORDER BY seq DESC LIMIT ?`)
      .all(workspaceId, conversationId, before, limit + 1) as unknown as MessageRow[]);
    const hasMore = rows.length > limit;
    const window = rows.slice(0, limit).reverse();
    return {
      messages: window.map(r => this.toMessage(r)),
      oldestSeq: window[0]?.seq,
      hasMore,
    };
  }

  /** All messages up to a seq, ascending (used to build run context). */
  listUpTo(workspaceId: string, conversationId: string, upToSeq?: number, limit = 1000): ConversationMessage[] {
    const rows = upToSeq === undefined
      ? (this.db.prepare('SELECT * FROM core_message WHERE workspace_id=? AND conversation_id=? ORDER BY seq DESC LIMIT ?').all(workspaceId, conversationId, limit) as unknown as MessageRow[]).reverse()
      : (this.db.prepare('SELECT * FROM core_message WHERE workspace_id=? AND conversation_id=? AND seq<=? ORDER BY seq').all(workspaceId, conversationId, upToSeq) as unknown as MessageRow[]);
    return rows.map(r => this.toMessage(r));
  }

  listConversations(workspaceId: string): ConversationSummaryRow[] {
    return (this.db.prepare(`SELECT c.id, c.title, c.updated_at AS updated_at,
        (SELECT content FROM core_message m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id ORDER BY seq DESC LIMIT 1) AS preview,
        (SELECT COUNT(*) FROM core_message m WHERE m.workspace_id=c.workspace_id AND m.conversation_id=c.id) AS count
      FROM core_conversation c WHERE c.workspace_id=? ORDER BY c.updated_at DESC`).all(workspaceId) as
      Array<{ id: string; title: string; updated_at: string; preview: string | null; count: number }>)
      .map(r => ({ id: r.id, title: r.title, updatedAt: r.updated_at, lastMessagePreview: r.preview ?? '', messageCount: r.count }));
  }

  rename(workspaceId: string, conversationId: string, title: string): void {
    this.db.prepare('UPDATE core_conversation SET title=?, updated_at=? WHERE workspace_id=? AND id=?')
      .run(title.slice(0, 120), isoNow(), workspaceId, conversationId);
  }

  deleteConversation(workspaceId: string, conversationId: string): void {
    this.ctx.transaction(() => {
      const runs = this.db.prepare("SELECT id FROM core_run WHERE workspace_id=? AND conversation_id=?").all(workspaceId, conversationId) as unknown as Array<{ id: string }>;
      for (const run of runs) {
        this.db.prepare('DELETE FROM core_tool_invocation WHERE run_id=?').run(run.id);
        this.db.prepare('DELETE FROM core_context_plan WHERE run_id=?').run(run.id);
        this.db.prepare('DELETE FROM core_run_event WHERE run_id=?').run(run.id);
      }
      this.db.prepare('DELETE FROM core_run WHERE workspace_id=? AND conversation_id=?').run(workspaceId, conversationId);
      this.db.prepare('DELETE FROM core_message WHERE workspace_id=? AND conversation_id=?').run(workspaceId, conversationId);
      this.db.prepare('DELETE FROM core_conversation_summary WHERE workspace_id=? AND conversation_id=?').run(workspaceId, conversationId);
      this.db.prepare('DELETE FROM core_artifact_link WHERE workspace_id=? AND conversation_id=?').run(workspaceId, conversationId);
      this.db.prepare('DELETE FROM core_conversation WHERE workspace_id=? AND id=?').run(workspaceId, conversationId);
    });
  }

  private toMessage(r: MessageRow): ConversationMessage {
    const metadata = r.metadata_json ? (JSON.parse(r.metadata_json) as unknown as Record<string, unknown>) : undefined;
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      conversationId: r.conversation_id,
      runId: r.run_id ?? undefined,
      seq: r.seq,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      metadata,
      artifactIds: (metadata?.artifactIds as string[] | undefined) ?? undefined,
    };
  }
}
