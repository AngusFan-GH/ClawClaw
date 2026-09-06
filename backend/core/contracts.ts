/**
 * Stable domain contracts for the ClawCore runtime.
 *
 * These types deliberately contain no OpenClaw or desktop-host concepts. They
 * are shared by every execution surface: chat, schedules, channels and future
 * workflows.
 */

export type Id = string;
export type IsoDate = string;

export type RunStatus =
  | 'queued'
  | 'preparing'
  | 'streaming'
  | 'waiting_for_approval'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RunSource = 'chat' | 'schedule' | 'channel' | 'workflow' | 'system';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface RunBudget {
  maxTurns: number;
  maxToolCalls: number;
  maxWallTimeMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface RunRecord {
  id: Id;
  workspaceId: Id;
  conversationId: Id;
  agentId: Id;
  source: RunSource;
  status: RunStatus;
  idempotencyKey: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  budget: RunBudget;
  turnCount: number;
  toolCallCount: number;
  error?: { code: string; message: string };
}

export interface ConversationMessage {
  id: Id;
  conversationId: Id;
  runId?: Id;
  role: MessageRole;
  content: string;
  createdAt: IsoDate;
  metadata?: Record<string, unknown>;
}

export interface ToolRequest {
  id: Id;
  runId: Id;
  toolName: string;
  arguments: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost?: number;
}

export type RunEventType =
  | 'run.started'
  | 'run.status'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'message.delta'
  | 'message.completed'
  | 'reasoning.delta'
  | 'tool.requested'
  | 'tool.approved'
  | 'tool.denied'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'usage.updated'
  | 'approval.required';

export interface RunEvent<TPayload = unknown> {
  eventId: Id;
  runId: Id;
  sequence: number;
  type: RunEventType;
  occurredAt: IsoDate;
  payload: TPayload;
}

export interface RunEventStore {
  append<TPayload>(event: Omit<RunEvent<TPayload>, 'eventId' | 'sequence' | 'occurredAt'>): RunEvent<TPayload>;
  list(runId: Id, afterSequence?: number): RunEvent[];
}

export interface RunStore {
  create(run: RunRecord): RunRecord;
  get(runId: Id): RunRecord | undefined;
  update(runId: Id, patch: Partial<Pick<RunRecord, 'status' | 'updatedAt' | 'turnCount' | 'toolCallCount' | 'error'>>): RunRecord;
  findByIdempotencyKey(workspaceId: Id, key: string): RunRecord | undefined;
}

export const DEFAULT_RUN_BUDGET: RunBudget = {
  maxTurns: 12,
  maxToolCalls: 24,
  maxWallTimeMs: 15 * 60 * 1000,
  maxInputTokens: 200_000,
  maxOutputTokens: 32_000,
};
