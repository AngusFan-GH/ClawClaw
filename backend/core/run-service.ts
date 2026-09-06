import { randomUUID } from 'node:crypto';
import {
  DEFAULT_RUN_BUDGET,
  type AgentSnapshot,
  type ApprovalPolicy,
  type Id,
  type RunBudget,
  type RunEvent,
  type RunRecord,
  type RunSource,
  type RunStatus,
  type ToolInvocationRecord,
  type ToolRisk,
} from './contracts';
import { argsDigest, isoNow, summarizeArgs } from './util';
import { RunRepository } from './run-repository';
import { assertRunTransition, isTerminalRunStatus } from './run-state';

export interface CreateRunInput {
  workspaceId: Id;
  conversationId: Id;
  agentId: Id;
  source: RunSource;
  idempotencyKey: string;
  agentSnapshot: AgentSnapshot;
  budget?: Partial<RunBudget>;
}

export interface RecordToolInput {
  toolCallId: string;
  toolName: string;
  toolVersion: number;
  args: Record<string, unknown>;
  risk: ToolRisk;
  approvalPolicy: ApprovalPolicy;
  initialStatus?: ToolInvocationRecord['status'];
}

const NON_TERMINAL_RECOVERABLE: RunStatus[] = ['queued', 'preparing', 'streaming', 'stopping'];

export class RunService {
  constructor(
    private readonly repo: RunRepository,
    private readonly onEvent?: (event: RunEvent) => void,
  ) {}

  create(input: CreateRunInput): { run: RunRecord; created: boolean } {
    const existing = this.repo.findByIdempotencyKey(input.workspaceId, input.idempotencyKey);
    if (existing) return { run: existing, created: false };

    const now = isoNow();
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
      agentSnapshot: input.agentSnapshot,
      budget: { ...DEFAULT_RUN_BUDGET, ...input.agentSnapshot.budget, ...input.budget },
      turnCount: 0,
      toolCallCount: 0,
    };
    const event = this.repo.transaction(() => {
      this.repo.create(run);
      return this.emit(run.id, 'run.started', { source: run.source, status: run.status });
    });
    return { run: { ...run }, created: Boolean(event) };
  }

  transition(runId: Id, status: RunStatus, payload: Record<string, unknown> = {}): RunRecord {
    const current = this.requireRun(runId);
    assertRunTransition(current.status, status);
    return this.repo.transaction(() => {
      const next = this.repo.update(runId, { status, updatedAt: isoNow() });
      this.emit(runId, 'run.status', { from: current.status, to: status, ...payload });
      if (status === 'completed') this.emit(runId, 'run.completed', payload);
      if (status === 'cancelled') this.emit(runId, 'run.cancelled', payload);
      return next;
    });
  }

  fail(runId: Id, error: { code: string; message: string }): RunRecord {
    const current = this.requireRun(runId);
    if (isTerminalRunStatus(current.status)) return current;
    return this.repo.transaction(() => {
      assertRunTransition(current.status, 'failed');
      const next = this.repo.update(runId, { status: 'failed', error, updatedAt: isoNow() });
      this.emit(runId, 'run.failed', error);
      return next;
    });
  }

  cancel(runId: Id, reason = 'Cancelled by user'): RunRecord {
    const current = this.requireRun(runId);
    if (isTerminalRunStatus(current.status)) return current;
    if (current.status === 'queued') return this.transition(runId, 'cancelled', { reason });
    this.transition(runId, 'stopping', { reason });
    return this.transition(runId, 'cancelled', { reason });
  }

  eventLog(runId: Id, afterSequence?: number): RunEvent[] {
    this.requireRun(runId);
    return this.repo.list(runId, afterSequence);
  }

  get(runId: Id): RunRecord | undefined {
    return this.repo.get(runId);
  }

  requireRun(runId: Id): RunRecord {
    return this.repo.get(runId) ?? ((): never => { throw new Error(`RUN_NOT_FOUND: Run not found: ${runId}`); })();
  }

  incrementTurn(runId: Id): RunRecord {
    const run = this.requireRun(runId);
    return this.repo.update(runId, { turnCount: run.turnCount + 1, updatedAt: isoNow() });
  }

  incrementToolCall(runId: Id): RunRecord {
    const run = this.requireRun(runId);
    return this.repo.update(runId, { toolCallCount: run.toolCallCount + 1, updatedAt: isoNow() });
  }

  emit(runId: Id, type: RunEvent['type'], payload: unknown): RunEvent {
    const event = this.repo.append({ runId, type, payload });
    this.onEvent?.(event);
    return event;
  }

  // ---- Tool invocations ---------------------------------------------------

  recordToolRequest(run: RunRecord, input: RecordToolInput): ToolInvocationRecord {
    return this.repo.upsertToolInvocation({
      toolCallId: input.toolCallId,
      run,
      toolName: input.toolName,
      toolVersion: input.toolVersion,
      argsDigest: argsDigest(input.args),
      argsSummary: summarizeArgs(input.args ?? {}),
      risk: input.risk,
      approvalPolicy: input.approvalPolicy,
      status: input.initialStatus ?? 'requested',
    });
  }

  getToolInvocation(runId: Id, toolCallId: string): ToolInvocationRecord | undefined {
    return this.repo.getToolInvocationByCall(runId, toolCallId);
  }

  listToolInvocations(runId: Id): ToolInvocationRecord[] {
    return this.repo.listToolInvocations(runId);
  }

  pendingTool(runId: Id): ToolInvocationRecord | undefined {
    return this.repo.latestPendingForRun(runId);
  }

  approve(runId: Id, toolCallId: string, approver = 'user'): ToolInvocationRecord {
    const invocation = this.requireInvocation(runId, toolCallId);
    if (invocation.status !== 'requested') {
      return invocation; // idempotent: a repeated approval is a no-op
    }
    const updated = this.repo.updateToolInvocation(invocation.id, {
      status: 'approved',
      approver,
      approvedAt: isoNow(),
      denialReason: null,
    });
    this.emit(runId, 'tool.approved', { toolCallId, toolName: invocation.toolName, approver });
    return updated;
  }

  deny(runId: Id, toolCallId: string, reason = 'Denied by user', approver = 'user'): ToolInvocationRecord {
    const invocation = this.requireInvocation(runId, toolCallId);
    if (invocation.status !== 'requested') return invocation;
    const updated = this.repo.updateToolInvocation(invocation.id, {
      status: 'denied',
      approver,
      denialReason: reason,
    });
    this.emit(runId, 'tool.denied', { toolCallId, toolName: invocation.toolName, reason, approver });
    return updated;
  }

  markToolRunning(runId: Id, toolCallId: string): ToolInvocationRecord {
    const invocation = this.requireInvocation(runId, toolCallId);
    return this.repo.updateToolInvocation(invocation.id, { status: 'running' });
  }

  completeTool(runId: Id, toolCallId: string, resultSummary: unknown): ToolInvocationRecord {
    const invocation = this.requireInvocation(runId, toolCallId);
    const updated = this.repo.updateToolInvocation(invocation.id, { status: 'completed', resultSummary });
    this.emit(runId, 'tool.completed', { toolCallId, toolName: invocation.toolName, result: resultSummary });
    return updated;
  }

  failTool(runId: Id, toolCallId: string, code: string, message: string): ToolInvocationRecord {
    const invocation = this.requireInvocation(runId, toolCallId);
    const updated = this.repo.updateToolInvocation(invocation.id, { status: 'failed', errorCode: code, errorMessage: message });
    this.emit(runId, 'tool.failed', { toolCallId, toolName: invocation.toolName, code, message });
    return updated;
  }

  /**
   * Startup recovery. Streaming/queued/preparing runs from a crashed process
   * cannot be resumed (the model stream is gone), so they terminate with an
   * explicit error. Runs paused at an approval remain resumable. Completed
   * tool calls are never re-executed; orphaned 'running' invocations fail.
   */
  recoverInterrupted(): { failedRuns: number; failedInvocations: number } {
    let failedRuns = 0;
    for (const run of this.repo.listByStatus(NON_TERMINAL_RECOVERABLE)) {
      this.repo.transaction(() => {
        const next = this.repo.update(run.id, {
          status: 'failed',
          error: { code: 'RUN_INTERRUPTED', message: 'The run was interrupted by an application restart' },
          updatedAt: isoNow(),
        });
        this.repo.append({ runId: run.id, type: 'run.failed', payload: { code: 'RUN_INTERRUPTED', message: next.error?.message } });
      });
      failedRuns += 1;
    }
    let failedInvocations = 0;
    for (const invocation of this.repo.listInvocationsByStatusGlobal('running')) {
      this.repo.updateToolInvocation(invocation.id, {
        status: 'failed',
        errorCode: 'RUN_INTERRUPTED',
        errorMessage: 'Tool execution was interrupted by an application restart',
      });
      failedInvocations += 1;
    }
    return { failedRuns, failedInvocations };
  }

  private requireInvocation(runId: Id, toolCallId: string): ToolInvocationRecord {
    return (
      this.repo.getToolInvocationByCall(runId, toolCallId) ??
      ((): never => { throw new Error('TOOL_NOT_PENDING: Tool call is not pending for this run'); })()
    );
  }
}
