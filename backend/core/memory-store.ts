/**
 * Workspace-scoped memory retrieval.
 *
 * There is no embedding model; retrieval uses SQLite FTS5 keyword search and is
 * named accordingly ("keyword search"). Results are workspace-isolated and
 * ordered by relevance then recency. Conversation summaries record the exact
 * source cursor range they cover — content is never silently truncated.
 */
import { randomUUID } from 'node:crypto';
import type { CoreDatabase } from './db/database';
import { fail } from './errors';
import { isoNow } from './util';

export interface MemoryInput {
  content: string;
  tags?: string[];
  sourceConversationId?: string | null;
}

export interface MemoryItem extends MemoryInput {
  id: string;
  workspaceId: string;
  tags: string[];
  retrievalVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface SummaryInput {
  conversationId: string;
  cursorStartSeq: number;
  cursorEndSeq: number;
  tokenEstimate: number;
  content: string;
}

export interface ConversationSummary extends SummaryInput {
  id: string;
  workspaceId: string;
  version: number;
  invalidated: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ItemRow {
  id: string; workspace_id: string; source_conversation_id: string | null; content: string;
  tags_json: string; retrieval_version: number; created_at: string; updated_at: string;
}

export class MemoryStore {
  constructor(private readonly ctx: CoreDatabase) {}

  private get db() {
    return this.ctx.db;
  }

  add(workspaceId: string, input: MemoryInput): MemoryItem {
    const content = input.content?.trim();
    if (!content) fail('INVALID_ARGUMENT', 'Memory content is required');
    const id = randomUUID();
    const ts = isoNow();
    const tags = JSON.stringify(input.tags ?? []);
    this.ctx.transaction(() => {
      this.db.prepare(`INSERT INTO core_memory_item
        (id,workspace_id,source_conversation_id,content,tags_json,retrieval_version,created_at,updated_at)
        VALUES (?,?,?,?,?,1,?,?)`)
        .run(id, workspaceId, input.sourceConversationId ?? null, content, tags, ts, ts);
      const rowid = (this.db.prepare('SELECT rowid FROM core_memory_item WHERE id=? AND workspace_id=?').get(id, workspaceId) as { rowid: number }).rowid;
      this.db.prepare('INSERT INTO core_memory_fts(rowid,content,tags,item_id) VALUES (?,?,?,?)').run(rowid, content, tags, id);
    });
    return this.get(workspaceId, id)!;
  }

  get(workspaceId: string, id: string): MemoryItem | undefined {
    const row = this.db.prepare('SELECT * FROM core_memory_item WHERE workspace_id=? AND id=?').get(workspaceId, id) as unknown as ItemRow | undefined;
    return row ? this.toItem(row) : undefined;
  }

  list(workspaceId: string, limit = 100): MemoryItem[] {
    return (this.db.prepare('SELECT * FROM core_memory_item WHERE workspace_id=? ORDER BY updated_at DESC LIMIT ?').all(workspaceId, limit) as unknown as ItemRow[])
      .map(r => this.toItem(r));
  }

  update(workspaceId: string, id: string, patch: Partial<Pick<MemoryInput, 'content' | 'tags'>>): MemoryItem {
    const row = this.row(workspaceId, id) ?? fail('MEMORY_NOT_FOUND', 'Memory item not found');
    const content = patch.content ?? row.content;
    const tags = JSON.stringify(patch.tags ?? safeTags(row.tags_json));
    this.ctx.transaction(() => {
      this.db.prepare('UPDATE core_memory_item SET content=?, tags_json=?, updated_at=? WHERE workspace_id=? AND id=?')
        .run(content, tags, isoNow(), workspaceId, id);
      this.db.prepare('DELETE FROM core_memory_fts WHERE rowid=?').run(row.rowid);
      this.db.prepare('INSERT INTO core_memory_fts(rowid,content,tags,item_id) VALUES (?,?,?,?)')
        .run(row.rowid, content, tags, id);
    });
    return this.get(workspaceId, id)!;
  }

  delete(workspaceId: string, id: string): void {
    const row = this.row(workspaceId, id) ?? fail('MEMORY_NOT_FOUND', 'Memory item not found');
    this.ctx.transaction(() => {
      this.db.prepare('DELETE FROM core_memory_fts WHERE rowid=?').run(row.rowid);
      this.db.prepare('DELETE FROM core_memory_item WHERE workspace_id=? AND id=?').run(workspaceId, id);
    });
  }

  private row(workspaceId: string, id: string): (ItemRow & { rowid: number }) | undefined {
    const row = this.db.prepare('SELECT *, rowid FROM core_memory_item WHERE workspace_id=? AND id=?').get(workspaceId, id) as (ItemRow & { rowid: number }) | undefined;
    return row;
  }

  /** Keyword (FTS5) search; falls back to LIKE when the query is not FTS-parseable. */
  search(workspaceId: string, query: string, limit = 6): MemoryItem[] {
    const terms = tokenize(query);
    if (!terms.length) return [];
    const match = terms.map(t => `"${t}"*`).join(' OR ');
    try {
      const rows = this.db.prepare(`
        SELECT m.* FROM core_memory_fts f
        JOIN core_memory_item m ON m.rowid = f.rowid
        WHERE core_memory_fts MATCH ? AND m.workspace_id = ?
        ORDER BY f.rank, m.updated_at DESC LIMIT ?`).all(match, workspaceId, limit) as unknown as ItemRow[];
      if (rows.length) return rows.map(r => this.toItem(r));
    } catch {
      // fall through to LIKE
    }
    const where = terms.map(() => 'content LIKE ?').join(' OR ');
    const params = terms.map(t => `%${t}%`);
    return (this.db.prepare(`SELECT * FROM core_memory_item WHERE workspace_id=? AND (${where}) ORDER BY updated_at DESC LIMIT ?`)
      .all(workspaceId, ...params, limit) as unknown as ItemRow[]).map(r => this.toItem(r));
  }

  // ---- Summaries ----------------------------------------------------------

  addSummary(workspaceId: string, input: SummaryInput): ConversationSummary {
    const versionRow = this.db
      .prepare('SELECT COALESCE(MAX(version),0) v FROM core_conversation_summary WHERE workspace_id=? AND conversation_id=?')
      .get(workspaceId, input.conversationId) as unknown as { v: number };
    const id = randomUUID();
    const ts = isoNow();
    this.db.prepare(`INSERT INTO core_conversation_summary
      (id,workspace_id,conversation_id,version,cursor_start_seq,cursor_end_seq,token_estimate,content,invalidated,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,0,?,?)`)
      .run(id, workspaceId, input.conversationId, versionRow.v + 1, input.cursorStartSeq, input.cursorEndSeq,
        input.tokenEstimate, input.content, ts, ts);
    return this.latestSummary(workspaceId, input.conversationId)!;
  }

  latestSummary(workspaceId: string, conversationId: string): ConversationSummary | undefined {
    const row = this.db
      .prepare('SELECT * FROM core_conversation_summary WHERE workspace_id=? AND conversation_id=? AND invalidated=0 ORDER BY version DESC LIMIT 1')
      .get(workspaceId, conversationId) as unknown as SummaryRow | undefined;
    return row ? this.toSummary(row) : undefined;
  }

  invalidate(workspaceId: string, conversationId: string): void {
    this.db.prepare('UPDATE core_conversation_summary SET invalidated=1, updated_at=? WHERE workspace_id=? AND conversation_id=?')
      .run(isoNow(), workspaceId, conversationId);
  }

  private toItem(r: ItemRow): MemoryItem {
    return {
      id: r.id, workspaceId: r.workspace_id, content: r.content,
      tags: safeTags(r.tags_json), sourceConversationId: r.source_conversation_id ?? undefined,
      retrievalVersion: r.retrieval_version, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  private toSummary(r: SummaryRow): ConversationSummary {
    return {
      id: r.id, workspaceId: r.workspace_id, conversationId: r.conversation_id, version: r.version,
      cursorStartSeq: r.cursor_start_seq, cursorEndSeq: r.cursor_end_seq, tokenEstimate: r.token_estimate,
      content: r.content, invalidated: r.invalidated === 1, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
}

interface SummaryRow {
  id: string; workspace_id: string; conversation_id: string; version: number;
  cursor_start_seq: number; cursor_end_seq: number; token_estimate: number; content: string;
  invalidated: number; created_at: string; updated_at: string;
}

function safeTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function tokenize(query: string): string[] {
  return (query ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(t => t.replace(/^-+|-+$/g, ''))
    .filter(t => t.length >= 2)
    .slice(0, 16);
}
