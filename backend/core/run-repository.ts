/**
 * SQLite-backed repository for runs, the event log, tool invocations and
 * context plans. Every cross-table mutation goes through the shared
 * CoreDatabase transaction so partial writes cannot occur.
 */
import { randomUUID } from 'node:crypto';
import type { CoreDatabase } from './db/database';
import type {
  AgentSnapshot,
  ContextPlan,
  ConversationMessage,
  Id,
  RunBudget,
  RunEvent,
  RunRecord,
  RunSource,
  RunStatus,
  RunStore,
  RunEventStore,
  ToolInvocationRecord,
  ToolInvocationStatus,
  ToolRisk,
  ApprovalPolicy,
} from './contracts';
import { isoNow } from './util';

type DB = CoreDatabase;

export class RunRepository implements RunStore, RunEventStore {
  constructor(private readonly ctx: DB) {}

  private get db() {
    return this.ctx.db;
  }

  transaction<T>(fn: () => T): T {
    return this.ctx.transaction(fn);
  }

  // ---- Runs ---------------------------------------------------------------

  create(run: RunRecord): RunRecord {
    this.db
      .prepare(`INSERT INTO core_run
        (id,workspace_id,conversation_id,agent_id,source,status,idempotency_key,agent_snapshot_json,budget_json,turn_count,tool_call_count,error_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        run.id, run.workspaceId, run.conversationId, run.agentId, run.source, run.status,
        run.idempotencyKey, run.agentSnapshot ? JSON.stringify(run.agentSnapshot) : null,
        JSON.stringify(run.budget), run.turnCount, run.toolCallCount,
        run.error ? JSON.stringify(run.error) : null, run.createdAt, run.updatedAt,
      );
    return { ...run };
  }

  get(runId: Id): RunRecord | undefined {
    const row = this.db.prepare('SELECT * FROM core_run WHERE id=?').get(runId) as unknown as RunRow | undefined;
    return row ? this.toRun(row) : undefined;
  }

  update(runId: Id, patch: Partial<Pick<RunRecord, 'status' | 'updatedAt' | 'turnCount' | 'toolCallCount' | 'error'>>): RunRecord {
    const current = this.get(runId);
    if (!current) throw new Error(`Run not found: ${runId}`);
    const next: RunRecord = { ...current, ...patch };
    this.db
      .prepare('UPDATE core_run SET status=?, updated_at=?, turn_count=?, tool_call_count=?, error_json=? WHERE id=?')
      .run(next.status, next.updatedAt, next.turnCount, next.toolCallCount, next.error ? JSON.stringify(next.error) : null, runId);
    return next;
  }

  findByIdempotencyKey(workspaceId: Id, key: string): RunRecord | undefined {
    const row = this.db.prepare('SELECT * FROM core_run WHERE workspace_id=? AND idempotency_key=?').get(workspaceId, key) as unknown as RunRow | undefined;
    return row ? this.toRun(row) : undefined;
  }

  listByStatus(statuses: RunStatus[]): RunRecord[] {
    if (!statuses.length) return [];
    const placeholders = statuses.map(() => '?').join(',');
    return (this.db.prepare(`SELECT * FROM core_run WHERE status IN (${placeholders})`).all(...statuses) as unknown as RunRow[]).map(r => this.toRun(r));
  }

  listForConversation(workspaceId: Id, conversationId: Id): RunRecord[] {
    return (this.db.prepare('SELECT * FROM core_run WHERE workspace_id=? AND conversation_id=? ORDER BY created_at').all(workspaceId, conversationId) as unknown as RunRow[])
      .map(r => this.toRun(r));
  }

  // ---- Events -------------------------------------------------------------

  append<TPayload>(event: Omit<RunEvent<TPayload>, 'eventId' | 'sequence' | 'occurredAt'>): RunEvent<TPayload> {
    return this.ctx.transaction(() => {
      const row = this.db.prepare('SELECT COALESCE(MAX(sequence),0) m FROM core_run_event WHERE run_id=?').get(event.runId) as unknown as { m: number };
      const stored: RunEvent<TPayload> = {
        ...event,
        eventId: randomUUID(),
        sequence: row.m + 1,
        occurredAt: isoNow(),
      };
      this.db
        .prepare('INSERT INTO core_run_event (event_id,run_id,sequence,type,occurred_at,payload_json) VALUES (?,?,?,?,?,?)')
        .run(stored.eventId, stored.runId, stored.sequence, stored.type, stored.occurredAt, JSON.stringify(stored.payload));
      return stored;
    });
  }

  list(runId: Id, afterSequence = 0): RunEvent[] {
    return (this.db
      .prepare('SELECT * FROM core_run_event WHERE run_id=? AND sequence>? ORDER BY sequence').all(runId, afterSequence) as unknown as EventRow[])
      .map(r => ({
        eventId: r.event_id, runId: r.run_id, sequence: r.sequence, type: r.type as RunEvent['type'],
        occurredAt: r.occurred_at, payload: JSON.parse(r.payload_json),
      }));
  }

  // ---- Tool invocations ---------------------------------------------------

  upsertToolInvocation(input: {
    toolCallId: string;
    run: RunRecord;
    toolName: string;
    toolVersion: number;
    argsDigest: string;
    argsSummary: Record<string, unknown>;
    risk: ToolRisk;
    approvalPolicy: ApprovalPolicy;
    status: ToolInvocationStatus;
  }): ToolInvocationRecord {
    const existing = this.getToolInvocationByCall(input.run.id, input.toolCallId);
    if (existing) return existing;
    const ts = isoNow();
    const id = randomUUID();
    this.db
      .prepare(`INSERT INTO core_tool_invocation
        (id,tool_call_id,run_id,workspace_id,tool_name,tool_version,args_digest,args_summary_json,risk,approval_policy,status,approver,approved_at,denial_reason,result_summary_json,error_code,error_message,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,?,?)`)
      .run(id, input.toolCallId, input.run.id, input.run.workspaceId, input.toolName, input.toolVersion,
        input.argsDigest, JSON.stringify(input.argsSummary), input.risk, input.approvalPolicy, input.status, ts, ts);
    return this.getToolInvocation(id)!;
  }

  getToolInvocation(id: Id): ToolInvocationRecord | undefined {
    const row = this.db.prepare('SELECT * FROM core_tool_invocation WHERE id=?').get(id) as unknown as ToolRow | undefined;
    return row ? this.toTool(row) : undefined;
  }

  getToolInvocationByCall(runId: Id, toolCallId: string): ToolInvocationRecord | undefined {
    const row = this.db.prepare('SELECT * FROM core_tool_invocation WHERE run_id=? AND tool_call_id=?').get(runId, toolCallId) as unknown as ToolRow | undefined;
    return row ? this.toTool(row) : undefined;
  }

  latestPendingForRun(runId: Id): ToolInvocationRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM core_tool_invocation WHERE run_id=? AND status='requested' ORDER BY created_at DESC LIMIT 1")
      .get(runId) as unknown as ToolRow | undefined;
    return row ? this.toTool(row) : undefined;
  }

  updateToolInvocation(id: Id, patch: Partial<Pick<ToolInvocationRecord,
    'status' | 'approver' | 'approvedAt' | 'denialReason' | 'resultSummary' | 'errorCode' | 'errorMessage'>>): ToolInvocationRecord {
    const current = this.getToolInvocation(id);
    if (!current) throw new Error(`Tool invocation not found: ${id}`);
    const next = { ...current, ...patch, updatedAt: isoNow() };
    this.db
      .prepare(`UPDATE core_tool_invocation SET status=?, approver=?, approved_at=?, denial_reason=?, result_summary_json=?, error_code=?, error_message=?, updated_at=? WHERE id=?`)
      .run(next.status, next.approver ?? null, next.approvedAt ?? null, next.denialReason ?? null,
        next.resultSummary === undefined ? null : JSON.stringify(next.resultSummary),
        next.errorCode ?? null, next.errorMessage ?? null, next.updatedAt, id);
    return next;
  }

  listToolInvocations(runId: Id): ToolInvocationRecord[] {
    return (this.db.prepare('SELECT * FROM core_tool_invocation WHERE run_id=? ORDER BY created_at').all(runId) as unknown as ToolRow[]).map(r => this.toTool(r));
  }

  listInvocationsByStatus(workspaceId: Id, status: ToolInvocationStatus): ToolInvocationRecord[] {
    return (this.db.prepare('SELECT * FROM core_tool_invocation WHERE workspace_id=? AND status=? ORDER BY created_at').all(workspaceId, status) as unknown as ToolRow[])
      .map(r => this.toTool(r));
  }

  listInvocationsByStatusGlobal(status: ToolInvocationStatus): ToolInvocationRecord[] {
    return (this.db.prepare('SELECT * FROM core_tool_invocation WHERE status=? ORDER BY created_at').all(status) as unknown as ToolRow[])
      .map(r => this.toTool(r));
  }

  // ---- Context plans ------------------------------------------------------

  savePlan(run: RunRecord, plan: ContextPlan): void {
    const ts = isoNow();
    this.db
      .prepare(`INSERT INTO core_context_plan (id,run_id,workspace_id,conversation_id,sections_json,token_estimates_json,trim_reasons_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(run_id) DO UPDATE SET sections_json=excluded.sections_json, token_estimates_json=excluded.token_estimates_json,
          trim_reasons_json=excluded.trim_reasons_json, updated_at=excluded.updated_at`)
      .run(randomUUID(), run.id, run.workspaceId, run.conversationId,
        JSON.stringify(plan.sections), JSON.stringify(plan.tokenEstimates), JSON.stringify(plan.trimReasons), ts, ts);
  }

  getPlan(runId: Id): ContextPlan | undefined {
    const row = this.db.prepare('SELECT * FROM core_context_plan WHERE run_id=?').get(runId) as
      | { sections_json: string; token_estimates_json: string; trim_reasons_json: string }
      | undefined;
    if (!row) return undefined;
    return {
      sections: JSON.parse(row.sections_json),
      tokenEstimates: JSON.parse(row.token_estimates_json),
      trimReasons: JSON.parse(row.trim_reasons_json),
    };
  }

  // ---- mappers ------------------------------------------------------------

  private toRun(r: RunRow): RunRecord {
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      conversationId: r.conversation_id,
      agentId: r.agent_id,
      source: r.source as RunSource,
      status: r.status as RunStatus,
      idempotencyKey: r.idempotency_key,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      agentSnapshot: r.agent_snapshot_json ? (JSON.parse(r.agent_snapshot_json) as unknown as AgentSnapshot) : null,
      budget: JSON.parse(r.budget_json) as unknown as RunBudget,
      turnCount: r.turn_count,
      toolCallCount: r.tool_call_count,
      error: r.error_json ? (JSON.parse(r.error_json) as unknown as { code: string; message: string }) : undefined,
    };
  }

  private toTool(r: ToolRow): ToolInvocationRecord {
    return {
      id: r.id,
      toolCallId: r.tool_call_id,
      runId: r.run_id,
      workspaceId: r.workspace_id,
      toolName: r.tool_name,
      toolVersion: r.tool_version,
      argsDigest: r.args_digest,
      argsSummary: JSON.parse(r.args_summary_json) as unknown as Record<string, unknown>,
      risk: r.risk as ToolRisk,
      approvalPolicy: r.approval_policy as ApprovalPolicy,
      status: r.status as ToolInvocationStatus,
      approver: r.approver,
      approvedAt: r.approved_at,
      denialReason: r.denial_reason,
      resultSummary: r.result_summary_json ? JSON.parse(r.result_summary_json) : undefined,
      errorCode: r.error_code,
      errorMessage: r.error_message,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}

interface RunRow {
  id: string; workspace_id: string; conversation_id: string; agent_id: string; source: string; status: string;
  idempotency_key: string; agent_snapshot_json: string | null; budget_json: string; turn_count: number; tool_call_count: number;
  error_json: string | null; created_at: string; updated_at: string;
}
interface EventRow {
  event_id: string; run_id: string; sequence: number; type: string; occurred_at: string; payload_json: string;
}
interface ToolRow {
  id: string; tool_call_id: string; run_id: string; workspace_id: string; tool_name: string; tool_version: number;
  args_digest: string; args_summary_json: string; risk: string; approval_policy: string; status: string;
  approver: string | null; approved_at: string | null; denial_reason: string | null;
  result_summary_json: string | null; error_code: string | null; error_message: string | null;
  created_at: string; updated_at: string;
}

export type { ConversationMessage };
