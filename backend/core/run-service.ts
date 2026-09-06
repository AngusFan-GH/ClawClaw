import { randomUUID } from 'node:crypto';
import {
  DEFAULT_RUN_BUDGET,
  type Id,
  type RunBudget,
  type RunEvent,
  type RunEventStore,
  type RunRecord,
  type RunSource,
  type RunStatus,
  type RunStore,
} from './contracts';
import { assertRunTransition, isTerminalRunStatus } from './run-state';

type RunPersistence = RunStore & RunEventStore;

export interface CreateRunInput {
  workspaceId: Id;
  conversationId: Id;
  agentId: Id;
  source: RunSource;
  idempotencyKey: string;
  budget?: Partial<RunBudget>;
}

export class RunService {
  constructor(private readonly store: RunPersistence, private readonly onEvent?: (event: RunEvent) => void) {}

  create(input: CreateRunInput): { run: RunRecord; created: boolean } {
    const existing = this.store.findByIdempotencyKey(input.workspaceId, input.idempotencyKey);
    if (existing) return { run: existing, created: false };

    const now = new Date().toISOString();
    const run: RunRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      agentId: input.agentId,
      source: input.source,
      status: 'queued',
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
      budget: { ...DEFAULT_RUN_BUDGET, ...input.budget },
      turnCount: 0,
      toolCallCount: 0,
    };
    this.store.create(run);
    const event = this.emit(run.id, 'run.started', { source: run.source, status: run.status });
    return { run: { ...run }, created: Boolean(event) };
  }

  transition(runId: Id, status: RunStatus, payload: Record<string, unknown> = {}): RunRecord {
    const current = this.requireRun(runId);
    assertRunTransition(current.status, status);
    const next = this.store.update(runId, { status, updatedAt: new Date().toISOString() });
    this.emit(runId, 'run.status', { from: current.status, to: status, ...payload });
    if (status === 'completed') this.emit(runId, 'run.completed', payload);
    if (status === 'cancelled') this.emit(runId, 'run.cancelled', payload);
    return next;
  }

  fail(runId: Id, error: { code: string; message: string }): RunRecord {
    const current = this.requireRun(runId);
    if (!isTerminalRunStatus(current.status)) assertRunTransition(current.status, 'failed');
    const next = this.store.update(runId, { status: 'failed', error, updatedAt: new Date().toISOString() });
    this.emit(runId, 'run.failed', error);
    return next;
  }

  cancel(runId: Id, reason = 'Cancelled by user'): RunRecord {
    const current = this.requireRun(runId);
    if (isTerminalRunStatus(current.status)) return current;
    const target = current.status === 'queued' ? 'cancelled' : 'stopping';
    let next = this.transition(runId, target, { reason });
    if (target === 'stopping') next = this.transition(runId, 'cancelled', { reason });
    return next;
  }

  eventLog(runId: Id, afterSequence?: number): RunEvent[] {
    this.requireRun(runId);
    return this.store.list(runId, afterSequence);
  }

  get(runId: Id): RunRecord | undefined { return this.store.get(runId); }

  incrementTurn(runId: Id): RunRecord {
    const run = this.requireRun(runId);
    return this.store.update(runId, { turnCount: run.turnCount + 1, updatedAt: new Date().toISOString() });
  }

  incrementToolCall(runId: Id): RunRecord {
    const run = this.requireRun(runId);
    return this.store.update(runId, { toolCallCount: run.toolCallCount + 1, updatedAt: new Date().toISOString() });
  }

  emitCoreEvent(runId: Id, type: RunEvent['type'], payload: unknown): RunEvent {
    this.requireRun(runId);
    return this.emit(runId, type, payload);
  }

  private requireRun(runId: Id): RunRecord {
    const run = this.store.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  private emit(runId: Id, type: RunEvent['type'], payload: unknown): RunEvent {
    const event = this.store.append({ runId, type, payload });
    this.onEvent?.(event);
    return event;
  }
}
