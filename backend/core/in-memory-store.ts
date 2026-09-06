import { randomUUID } from 'node:crypto';
import type { Id, RunEvent, RunEventStore, RunRecord, RunStore } from './contracts';

/**
 * Reference store used by the first ClawCore vertical slice and tests.
 * The storage interface is intentionally independent from this implementation;
 * the production SQLite store replaces it without changing the run engine.
 */
export class InMemoryClawCoreStore implements RunStore, RunEventStore {
  private readonly runs = new Map<Id, RunRecord>();
  private readonly events = new Map<Id, RunEvent[]>();

  create(run: RunRecord): RunRecord {
    if (this.runs.has(run.id)) throw new Error(`Run already exists: ${run.id}`);
    this.runs.set(run.id, { ...run });
    return { ...run };
  }

  get(runId: Id): RunRecord | undefined {
    const run = this.runs.get(runId);
    return run ? { ...run } : undefined;
  }

  update(runId: Id, patch: Partial<Pick<RunRecord, 'status' | 'updatedAt' | 'turnCount' | 'toolCallCount' | 'error'>>): RunRecord {
    const current = this.runs.get(runId);
    if (!current) throw new Error(`Run not found: ${runId}`);
    const next = { ...current, ...patch };
    this.runs.set(runId, next);
    return { ...next };
  }

  findByIdempotencyKey(workspaceId: Id, key: string): RunRecord | undefined {
    for (const run of this.runs.values()) {
      if (run.workspaceId === workspaceId && run.idempotencyKey === key) return { ...run };
    }
    return undefined;
  }

  append<TPayload>(event: Omit<RunEvent<TPayload>, 'eventId' | 'sequence' | 'occurredAt'>): RunEvent<TPayload> {
    const existing = this.events.get(event.runId) ?? [];
    const stored: RunEvent<TPayload> = {
      ...event,
      eventId: randomUUID(),
      sequence: existing.length + 1,
      occurredAt: new Date().toISOString(),
    };
    existing.push(stored as RunEvent);
    this.events.set(event.runId, existing);
    return stored;
  }

  list(runId: Id, afterSequence = 0): RunEvent[] {
    return (this.events.get(runId) ?? []).filter((event) => event.sequence > afterSequence).map((event) => ({ ...event }));
  }
}
