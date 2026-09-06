import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { app } from '../host/desktop';
import type { ConversationMessage, Id, IsoDate, RunEvent, RunEventStore, RunRecord, RunStore } from './contracts';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

/** Durable ClawCore state. No OpenClaw file or schema is consulted here. */
export class SqliteClawCoreStore implements RunStore, RunEventStore {
  private readonly db: InstanceType<typeof DatabaseSync>;

  constructor(filePath = join(app.getPath('userData'), 'clawcore.sqlite')) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath, { enableForeignKeyConstraints: true, timeout: 5_000 });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS core_runs (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        agent_id TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        budget_json TEXT NOT NULL, turn_count INTEGER NOT NULL, tool_call_count INTEGER NOT NULL,
        error_json TEXT, UNIQUE(workspace_id, idempotency_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS core_run_events (
        event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES core_runs(id),
        sequence INTEGER NOT NULL, type TEXT NOT NULL, occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL, UNIQUE(run_id, sequence)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS core_run_events_cursor ON core_run_events(run_id, sequence);
      CREATE TABLE IF NOT EXISTS core_conversation_messages (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        run_id TEXT REFERENCES core_runs(id), role TEXT NOT NULL, content TEXT NOT NULL,
        created_at TEXT NOT NULL, metadata_json TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS core_conversation_history ON core_conversation_messages(workspace_id, conversation_id, created_at);
    `);
  }

  create(run: RunRecord): RunRecord {
    this.db.prepare(`INSERT INTO core_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(run.id, run.workspaceId, run.conversationId, run.agentId, run.source, run.status,
        run.idempotencyKey, run.createdAt, run.updatedAt, JSON.stringify(run.budget),
        run.turnCount, run.toolCallCount, run.error ? JSON.stringify(run.error) : null);
    return { ...run };
  }

  get(runId: Id): RunRecord | undefined {
    const row = this.db.prepare('SELECT * FROM core_runs WHERE id = ?').get(runId) as Record<string, unknown> | undefined;
    return row ? this.toRun(row) : undefined;
  }

  update(runId: Id, patch: Partial<Pick<RunRecord, 'status' | 'updatedAt' | 'turnCount' | 'toolCallCount' | 'error'>>): RunRecord {
    const current = this.get(runId);
    if (!current) throw new Error(`Run not found: ${runId}`);
    const next = { ...current, ...patch };
    this.db.prepare(`UPDATE core_runs SET status=?, updated_at=?, turn_count=?, tool_call_count=?, error_json=? WHERE id=?`)
      .run(next.status, next.updatedAt, next.turnCount, next.toolCallCount, next.error ? JSON.stringify(next.error) : null, runId);
    return next;
  }

  findByIdempotencyKey(workspaceId: Id, key: string): RunRecord | undefined {
    const row = this.db.prepare('SELECT * FROM core_runs WHERE workspace_id = ? AND idempotency_key = ?').get(workspaceId, key) as Record<string, unknown> | undefined;
    return row ? this.toRun(row) : undefined;
  }

  append<T>(event: Omit<RunEvent<T>, 'eventId' | 'sequence' | 'occurredAt'>): RunEvent<T> {
    const sequence = Number((this.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM core_run_events WHERE run_id = ?').get(event.runId) as { sequence: number }).sequence) + 1;
    const stored: RunEvent<T> = { ...event, eventId: crypto.randomUUID(), sequence, occurredAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO core_run_events VALUES (?, ?, ?, ?, ?, ?)')
      .run(stored.eventId, stored.runId, stored.sequence, stored.type, stored.occurredAt, JSON.stringify(stored.payload));
    return stored;
  }

  list(runId: Id, afterSequence = 0): RunEvent[] {
    return (this.db.prepare('SELECT * FROM core_run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence').all(runId, afterSequence) as Record<string, unknown>[])
      .map((row) => ({ eventId: String(row.event_id), runId: String(row.run_id), sequence: Number(row.sequence), type: row.type as RunEvent['type'], occurredAt: String(row.occurred_at), payload: JSON.parse(String(row.payload_json)) }));
  }

  appendMessage(message: ConversationMessage & { workspaceId: Id }): ConversationMessage {
    this.db.prepare('INSERT INTO core_conversation_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(message.id, message.workspaceId, message.conversationId, message.runId ?? null, message.role, message.content,
        message.createdAt, message.metadata ? JSON.stringify(message.metadata) : null);
    return { ...message };
  }

  listMessages(workspaceId: Id, conversationId: Id, limit = 80): ConversationMessage[] {
    return (this.db.prepare(`SELECT id, conversation_id, run_id, role, content, created_at, metadata_json
      FROM core_conversation_messages WHERE workspace_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT ?`)
      .all(workspaceId, conversationId, limit) as Record<string, unknown>[]).reverse().map(row => ({
        id: String(row.id), conversationId: String(row.conversation_id), runId: row.run_id ? String(row.run_id) : undefined,
        role: row.role as ConversationMessage['role'], content: String(row.content), createdAt: String(row.created_at),
        metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : undefined,
      }));
  }

  listConversations(workspaceId: Id): Array<{ id: Id; updatedAt: IsoDate; lastMessagePreview: string }> {
    return (this.db.prepare(`SELECT conversation_id, MAX(created_at) AS updated_at,
      (SELECT content FROM core_conversation_messages latest WHERE latest.workspace_id=m.workspace_id AND latest.conversation_id=m.conversation_id ORDER BY created_at DESC LIMIT 1) AS preview
      FROM core_conversation_messages m WHERE workspace_id=? GROUP BY conversation_id ORDER BY updated_at DESC`).all(workspaceId) as Record<string, unknown>[])
      .map(row => ({ id: String(row.conversation_id), updatedAt: String(row.updated_at), lastMessagePreview: String(row.preview || '') }));
  }

  deleteConversation(workspaceId: Id, conversationId: Id): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM core_conversation_messages WHERE workspace_id=? AND conversation_id=?').run(workspaceId, conversationId);
      this.db.prepare(`DELETE FROM core_run_events WHERE run_id IN (SELECT id FROM core_runs WHERE workspace_id=? AND conversation_id=?)`).run(workspaceId, conversationId);
      this.db.prepare('DELETE FROM core_runs WHERE workspace_id=? AND conversation_id=?').run(workspaceId, conversationId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK'); throw error;
    }
  }

  close(): void { this.db.close(); }

  private toRun(row: Record<string, unknown>): RunRecord {
    return { id: String(row.id), workspaceId: String(row.workspace_id), conversationId: String(row.conversation_id), agentId: String(row.agent_id), source: row.source as RunRecord['source'], status: row.status as RunRecord['status'], idempotencyKey: String(row.idempotency_key), createdAt: String(row.created_at), updatedAt: String(row.updated_at), budget: JSON.parse(String(row.budget_json)), turnCount: Number(row.turn_count), toolCallCount: Number(row.tool_call_count), error: row.error_json ? JSON.parse(String(row.error_json)) : undefined };
  }
}
