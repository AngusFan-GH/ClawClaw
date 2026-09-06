/**
 * Persistent cron jobs with a durable `(jobId, scheduledAt)` fire cursor.
 *
 * The cursor makes triggering idempotent across restarts and prevents
 * re-entrancy: a minute bucket is claimed (inserted) once. Only the current
 * zoned minute is eligible, so downtime is not replayed by default.
 */
import type { CoreDatabase } from './db/database';
import { fail } from './errors';
import { isoNow, newId } from './util';
import { parseCron, matchesZoned, type CronFields } from './cron/parser';
import { isValidTimezone, localTimezone, minuteKey, zonedParts } from './cron/timezone';

export interface CronDelivery {
  channelType?: string;
  accountId?: string;
}

export interface CronJobInput {
  id?: string;
  workspaceId?: string;
  name: string;
  message: string;
  schedule: string;
  timezone?: string;
  enabled?: boolean;
  agentId?: string | null;
  delivery?: CronDelivery | null;
  sessionTarget?: string | null;
}

export interface CronJobView {
  id: string;
  workspaceId: string;
  name: string;
  message: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  agentId?: string;
  delivery?: CronDelivery;
  sessionTarget?: string;
  lastRunAt?: string;
  lastStatus?: 'success' | 'error';
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

interface JobRow {
  id: string; workspace_id: string; name: string; message: string; schedule_expr: string; timezone: string;
  agent_id: string | null; delivery_json: string | null; session_target: string | null; enabled: number;
  last_run_at: string | null; last_status: string | null; last_error: string | null;
  created_at: string; updated_at: string;
}

export interface DueJob {
  job: CronJobView;
  scheduledAt: string;
}

export class CoreCronStore {
  private readonly fieldCache = new Map<string, CronFields>();

  constructor(private readonly ctx: CoreDatabase) {}

  private get db() {
    return this.ctx.db;
  }

  list(workspaceId = 'default'): CronJobView[] {
    return (this.db.prepare('SELECT * FROM core_cron_job WHERE workspace_id=? ORDER BY updated_at DESC').all(workspaceId) as unknown as JobRow[])
      .map(r => this.toView(r));
  }

  get(workspaceId: string, id: string): CronJobView | undefined {
    const row = this.db.prepare('SELECT * FROM core_cron_job WHERE workspace_id=? AND id=?').get(workspaceId, id) as unknown as JobRow | undefined;
    return row ? this.toView(row) : undefined;
  }

  require(workspaceId: string, id: string): CronJobView {
    return this.get(workspaceId, id) ?? fail('CRON_NOT_FOUND', 'The scheduled task does not exist');
  }

  getById(id: string): CronJobView | undefined {
    const row = this.db.prepare('SELECT * FROM core_cron_job WHERE id=?').get(id) as unknown as JobRow | undefined;
    return row ? this.toView(row) : undefined;
  }

  save(input: CronJobInput): CronJobView {
    const workspaceId = input.workspaceId ?? 'default';
    const name = input.name?.trim();
    const message = input.message?.trim();
    if (!name) fail('INVALID_ARGUMENT', 'Task name is required');
    if (!message) fail('INVALID_ARGUMENT', 'Task message is required');
    const fields = parseCron(input.schedule); // throws CRON_EXPRESSION_INVALID
    const timezone = input.timezone || localTimezone();
    if (!isValidTimezone(timezone)) fail('INVALID_ARGUMENT', 'Unknown timezone');
    this.fieldCache.set(input.schedule, fields);

    const existing = input.id ? this.get(workspaceId, input.id) : undefined;
    const id = existing?.id ?? input.id ?? newId();
    const ts = isoNow();
    this.db.prepare(`INSERT INTO core_cron_job
      (id,workspace_id,name,message,schedule_expr,timezone,agent_id,delivery_json,session_target,enabled,last_run_at,last_status,last_error,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,message=excluded.message,schedule_expr=excluded.schedule_expr,
        timezone=excluded.timezone,agent_id=excluded.agent_id,delivery_json=excluded.delivery_json,session_target=excluded.session_target,
        enabled=excluded.enabled,updated_at=excluded.updated_at`)
      .run(
        id, workspaceId, name, message, input.schedule.trim(), timezone,
        input.agentId === undefined ? (existing?.agentId ?? null) : input.agentId,
        JSON.stringify(input.delivery ?? null),
        input.sessionTarget === undefined ? (existing?.sessionTarget ?? null) : input.sessionTarget,
        (input.enabled ?? existing?.enabled ?? true) ? 1 : 0,
        existing?.lastRunAt ?? null, existing?.lastStatus ?? null, existing?.lastError ?? null,
        existing?.createdAt ?? ts, ts,
      );
    return this.require(workspaceId, id);
  }

  delete(workspaceId: string, id: string): void {
    this.require(workspaceId, id);
    this.ctx.transaction(() => {
      this.db.prepare('DELETE FROM core_cron_fire WHERE job_id=?').run(id);
      this.db.prepare('DELETE FROM core_cron_job WHERE workspace_id=? AND id=?').run(workspaceId, id);
    });
  }

  setEnabled(workspaceId: string, id: string, enabled: boolean): CronJobView {
    this.require(workspaceId, id);
    this.db.prepare('UPDATE core_cron_job SET enabled=?, updated_at=? WHERE workspace_id=? AND id=?')
      .run(enabled ? 1 : 0, isoNow(), workspaceId, id);
    return this.require(workspaceId, id);
  }

  /** Claim every enabled job whose current zoned minute matches and is unclaimed. */
  claimDue(now: Date = new Date()): DueJob[] {
    const due: DueJob[] = [];
    for (const row of this.db.prepare('SELECT * FROM core_cron_job WHERE enabled=1').all() as unknown as JobRow[]) {
      const fields = this.fieldCache.get(row.schedule_expr) ?? parseCron(row.schedule_expr);
      this.fieldCache.set(row.schedule_expr, fields);
      const parts = zonedParts(now, row.timezone);
      if (!matchesZoned(fields, parts)) continue;
      const scheduledAt = minuteKey(parts);
      const claimed = this.ctx.transaction(() => {
        const result = this.db
          .prepare("INSERT OR IGNORE INTO core_cron_fire (job_id,scheduled_at,fired_at,run_id,status,error) VALUES (?,?,?,NULL,'fired',NULL)")
          .run(row.id, scheduledAt, isoNow());
        return result.changes > 0;
      });
      if (claimed) due.push({ job: this.toView(row), scheduledAt });
    }
    return due;
  }

  recordFireResult(jobId: string, scheduledAt: string, runId: string | null, status: 'success' | 'error', error?: string): void {
    this.db.prepare('UPDATE core_cron_fire SET run_id=?, status=?, error=? WHERE job_id=? AND scheduled_at=?')
      .run(runId, status, error ?? null, jobId, scheduledAt);
    this.db.prepare('UPDATE core_cron_job SET last_run_at=?, last_status=?, last_error=? WHERE id=?')
      .run(isoNow(), status, error ?? null, jobId);
  }

  private toView(r: JobRow): CronJobView {
    let delivery: CronDelivery | undefined;
    try { delivery = r.delivery_json ? (JSON.parse(r.delivery_json) as unknown as CronDelivery) ?? undefined : undefined; } catch { delivery = undefined; }
    return {
      id: r.id, workspaceId: r.workspace_id, name: r.name, message: r.message, schedule: r.schedule_expr,
      timezone: r.timezone, enabled: r.enabled === 1, agentId: r.agent_id ?? undefined, delivery,
      sessionTarget: r.session_target ?? undefined, lastRunAt: r.last_run_at ?? undefined,
      lastStatus: r.last_status === 'success' ? 'success' : r.last_status === 'error' ? 'error' : undefined,
      lastError: r.last_error ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
}
