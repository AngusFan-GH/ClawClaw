/**
 * Stable domain contracts for the ClawCore runtime.
 *
 * These types deliberately contain no OpenClaw, Gateway or desktop-host
 * concepts. They are shared by every execution surface: chat, schedules,
 * channel inbound and (future) workflows.
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

export interface ToolPolicy {
  /** Tools the agent is allowed to request. */
  allowedTools: string[];
  /** When true, medium/high-risk tools still require explicit user approval. */
  requireApproval: boolean;
  maxArtifactReadBytes: number;
  maxListEntries: number;
}

export interface MemoryPolicy {
  enabled: boolean;
  maxItems: number;
  summaryThresholdTokens: number;
}

export interface RunBudget {
  maxTurns: number;
  maxToolCalls: number;
  maxWallTimeMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

/** Immutable per-run copy of the agent configuration. */
export interface AgentSnapshot {
  id: Id;
  name: string;
  systemPrompt: string;
  providerId?: string | null;
  model?: string | null;
  toolPolicy: ToolPolicy;
  memoryPolicy: MemoryPolicy;
  budget: RunBudget;
  enabledSkillIds: string[];
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
  agentSnapshot?: AgentSnapshot | null;
  budget: RunBudget;
  turnCount: number;
  toolCallCount: number;
  error?: { code: string; message: string };
}

export interface ConversationMessage {
  id: Id;
  workspaceId: Id;
  conversationId: Id;
  runId?: Id;
  seq: number;
  role: MessageRole;
  content: string;
  createdAt: IsoDate;
  metadata?: Record<string, unknown>;
  artifactIds?: Id[];
}

export type ToolRisk = 'low' | 'medium' | 'high';
export type ApprovalPolicy = 'auto' | 'always';
export type ToolInvocationStatus =
  | 'requested'
  | 'approved'
  | 'denied'
  | 'running'
  | 'completed'
  | 'failed';

export interface ToolInvocationRecord {
  id: Id;
  toolCallId: string;
  runId: Id;
  workspaceId: Id;
  toolName: string;
  toolVersion: number;
  argsDigest: string;
  argsSummary: Record<string, unknown>;
  risk: ToolRisk;
  approvalPolicy: ApprovalPolicy;
  status: ToolInvocationStatus;
  approver?: string | null;
  approvedAt?: IsoDate | null;
  denialReason?: string | null;
  resultSummary?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
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
  | 'approval.required'
  | 'artifact.created';

export interface RunEvent<TPayload = unknown> {
  eventId: Id;
  runId: Id;
  sequence: number;
  type: RunEventType;
  occurredAt: IsoDate;
  payload: TPayload;
}

export interface ContextPlanSection {
  systemPrompt?: string;
  skills?: Array<{ id: string; name: string; instruction: string }>;
  summaries?: Array<{ version: number; content: string; cursorStartSeq: number; cursorEndSeq: number }>;
  memories?: Array<{ id: string; content: string }>;
  recentMessages?: ConversationMessage[];
}

export interface ContextPlan {
  sections: ContextPlanSection;
  tokenEstimates: Record<string, number>;
  trimReasons: string[];
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

export const DEFAULT_TOOL_POLICY: ToolPolicy = {
  allowedTools: ['core.time.getCurrentTime', 'core.artifact.readText', 'core.fs.listDirectory'],
  requireApproval: true,
  maxArtifactReadBytes: 200_000,
  maxListEntries: 500,
};

export const DEFAULT_MEMORY_POLICY: MemoryPolicy = {
  enabled: true,
  maxItems: 6,
  summaryThresholdTokens: 24_000,
};
