/**
 * Versioned, permissioned tool contract.
 *
 * Tools have no shell, process, network or arbitrary-path capability. They
 * validate arguments against a schema before approval policy is checked, and
 * only execute after that. Every tool is versioned so a run record can always
 * name the exact definition it requested.
 */
import type { ApprovalPolicy, ToolRisk } from '../contracts';
import type { ArtifactStore } from '../artifact-store';

export interface ToolExecutionContext {
  workspaceId: string;
  runId: string;
  artifacts: ArtifactStore;
  maxArtifactReadBytes: number;
  maxListEntries: number;
  now: Date;
}

export type ParamType = 'string' | 'number' | 'boolean';

export interface ParamSpec {
  name: string;
  type: ParamType;
  required?: boolean;
  maxLength?: number;
  description?: string;
}

export interface ToolResult {
  ok: boolean;
  output?: unknown;
  errorCode?: string;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  version: number;
  description: string;
  params: ParamSpec[];
  risk: ToolRisk;
  approvalPolicy: ApprovalPolicy;
  /** Schema validation; throws CoreError(TOOL_ARGUMENTS_INVALID). */
  validate(args: unknown): Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>;
}
