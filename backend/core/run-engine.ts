/**
 * ClawCore-owned agent loop.
 *
 * Each model completion is one turn. Tool calls are validated (schema, then
 * policy) before anything executes; approved calls run at most once and their
 * persisted results are fed back on the next turn. A call that requires
 * approval pauses the run in `waiting_for_approval` and the loop ends — a later
 * approval continues it, possibly after a restart.
 */
import type {
  AgentSnapshot,
  RunEvent,
  RunRecord,
  ToolInvocationRecord,
  UsageSnapshot,
} from './contracts';
import { isTerminalRunStatus } from './run-state';
import type { RunService } from './run-service';
import type { ConversationStore } from './conversation-store';
import type { ToolRegistry } from './tools/registry';
import type { ToolDefinition } from './tools/types';
import type { ToolResult } from './tools/types';
import type { ModelAdapter, ModelChatMessage, ModelCancellationSignal, ModelStreamEvent, ModelToolDescriptor, ModelTurn } from './model-adapter';
import type { ResolvedModelRoute } from './provider-resolver';

export interface BuiltTurn {
  route: ResolvedModelRoute;
  systemPrompt: string;
  messages: ModelChatMessage[];
  tools: ModelToolDescriptor[];
}

export interface EngineDeps {
  runs: RunService;
  conversations: ConversationStore;
  tools: ToolRegistry;
  model: ModelAdapter;
  signalFor(runId: string): ModelCancellationSignal;
  buildTurn(run: RunRecord, snapshot: AgentSnapshot): Promise<BuiltTurn>;
  executeApprovedTool(run: RunRecord, name: string, version: number, args: Record<string, unknown>): Promise<ToolResult>;
  afterRun?(run: RunRecord): Promise<void>;
}

export class RunEngine {
  constructor(private readonly deps: EngineDeps) {}

  /** Drive the run until terminal or until it pauses for approval. */
  async run(runId: string): Promise<void> {
    const deadline = Date.now() + (this.deps.runs.requireRun(runId).budget.maxWallTimeMs ?? 15 * 60_000);
    while (true) {
      const run = this.deps.runs.get(runId);
      if (!run || isTerminalRunStatus(run.status)) return;
      if (run.status === 'waiting_for_approval') return;
      if (this.deps.signalFor(runId)?.aborted) {
        this.deps.runs.cancel(runId, 'Cancelled');
        return;
      }
      if (Date.now() > deadline) {
        this.deps.runs.fail(runId, { code: 'RUN_TIME_BUDGET_EXCEEDED', message: 'Run exceeded its wall-time budget' });
        return;
      }

      const outcome = await this.turn(run, deadline);
      if (outcome === 'paused' || outcome === 'terminal') return;
      // outcome === 'continue' loops into the next model turn
    }
  }

  private nextWithAbort(
    iterator: AsyncIterator<ModelStreamEvent>,
    signal: ModelCancellationSignal,
  ): Promise<IteratorResult<ModelStreamEvent>> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setInterval(() => {
        if (signal.aborted && !settled) {
          settled = true;
          clearInterval(timer);
          void iterator.return?.().catch(() => undefined);
          reject(new Error('__run_aborted__'));
        }
      }, 40);
      iterator.next().then(
        (result) => {
          if (!settled) {
            settled = true;
            clearInterval(timer);
            resolve(result);
          }
        },
        (error) => {
          if (!settled) {
            settled = true;
            clearInterval(timer);
            reject(error);
          }
        },
      );
    });
  }

  private async turn(run: RunRecord, deadline: number): Promise<'continue' | 'paused' | 'terminal'> {
    if (run.turnCount >= run.budget.maxTurns) {
      this.deps.runs.fail(run.id, { code: 'RUN_TURN_BUDGET_EXCEEDED', message: 'Run turn budget exhausted' });
      return 'terminal';
    }

    // State transitions into the streaming phase.
    if (run.status === 'queued') {
      this.deps.runs.transition(run.id, 'preparing');
      this.deps.runs.transition(run.id, 'streaming');
    } else if (run.status === 'waiting_for_approval' || run.status === 'preparing') {
      this.deps.runs.transition(run.id, 'streaming');
    } // streaming/stopping continue

    this.deps.runs.incrementTurn(run.id);
    const built = await this.deps.buildTurn(this.deps.runs.requireRun(run.id), run.agentSnapshot ?? this.fallbackSnapshot(run));

    let completed:
      | { text: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; stopReason: string }
      | undefined;
    let streamError: { code: string; message: string } | undefined;

    const route = built.route;
    const stream = this.deps.model.stream(
      {
        systemPrompt: built.systemPrompt,
        messages: built.messages,
        tools: built.tools,
        model: {
          provider: route.vendorId,
          id: route.model,
          apiKey: route.apiKey,
          baseUrl: route.baseUrl,
          api: route.api,
          headers: route.headers,
        },
      },
      this.deps.signalFor(run.id),
    );
    const iterator = stream[Symbol.asyncIterator]();
    try {
      while (true) {
        const event = await this.nextWithAbort(iterator, this.deps.signalFor(run.id));
        if (event.done) break;
        const ev = event.value;
        if (Date.now() > deadline) {
          this.deps.runs.fail(run.id, { code: 'RUN_TIME_BUDGET_EXCEEDED', message: 'Run exceeded its wall-time budget' });
          return 'terminal';
        }
        switch (ev.type) {
          case 'text.delta':
            this.deps.runs.emit(run.id, 'message.delta', { text: ev.text });
            break;
          case 'reasoning.delta':
            this.deps.runs.emit(run.id, 'reasoning.delta', { text: ev.text });
            break;
          case 'usage':
            if (ev.usage.outputTokens > run.budget.maxOutputTokens) {
              this.deps.runs.fail(run.id, { code: 'RUN_OUTPUT_BUDGET_EXCEEDED', message: 'Model output exceeded the token budget' });
              return 'terminal';
            }
            this.deps.runs.emit(run.id, 'usage.updated', ev.usage);
            break;
          case 'error':
            streamError = { code: ev.code, message: ev.message };
            break;
          case 'complete':
            completed = { text: ev.message, toolCalls: ev.toolCalls, stopReason: ev.stopReason };
            break;
          case 'tool.call':
            // Live hint; the authoritative set arrives on complete.
            break;
        }
      }
    } catch (error) {
      if ((error as Error)?.message === '__run_aborted__') {
        const status = this.deps.runs.get(run.id)?.status;
        if (status && !isTerminalRunStatus(status)) this.deps.runs.cancel(run.id, 'Cancelled');
        return 'terminal';
      }
      this.deps.runs.fail(run.id, { code: 'MODEL_EXECUTION_FAILED', message: error instanceof Error ? error.message : 'Model execution failed' });
      return 'terminal';
    }

    if (streamError) {
      this.deps.runs.fail(run.id, streamError);
      return 'terminal';
    }
    if (!completed) {
      this.deps.runs.fail(run.id, { code: 'MODEL_STREAM_ENDED', message: 'Model stream ended without completion' });
      return 'terminal';
    }

    // Persist the assistant turn (text + any tool calls) as unknown as one message.
    const fresh = this.deps.runs.requireRun(run.id);
    if (completed.text || completed.toolCalls.length) {
      this.deps.conversations.append(fresh.workspaceId, fresh.conversationId, {
        runId: run.id,
        role: 'assistant',
        content: completed.text,
        metadata: completed.toolCalls.length ? { toolCalls: completed.toolCalls } : undefined,
      });
      if (completed.text) this.deps.runs.emit(run.id, 'message.completed', { text: completed.text });
    }

    if (!completed.toolCalls.length || completed.stopReason !== 'toolUse') {
      this.deps.runs.transition(run.id, 'completed');
      await this.deps.afterRun?.(this.deps.runs.requireRun(run.id)).catch(() => undefined);
      return 'terminal';
    }

    const pending: ToolInvocationRecord[] = [];
    if (fresh.toolCallCount + completed.toolCalls.length > run.budget.maxToolCalls) {
      this.deps.runs.fail(run.id, { code: 'RUN_TOOL_BUDGET_EXCEEDED', message: 'Run tool-call budget exhausted' });
      return 'terminal';
    }
    for (const call of completed.toolCalls) {
      this.deps.runs.incrementToolCall(run.id);
      const decision = this.decideTool(run, call);
      if (decision.kind === 'reject') {
        this.appendToolResult(run, call, { ok: false, errorCode: decision.code, error: decision.message }, true);
        continue;
      }
      const invocation = this.deps.runs.recordToolRequest(run, {
        toolCallId: call.id,
        toolName: call.name,
        toolVersion: decision.tool.version,
        args: call.arguments ?? {},
        risk: decision.tool.risk,
        approvalPolicy: decision.tool.approvalPolicy,
      });
      this.deps.runs.emit(run.id, 'tool.requested', {
        id: call.id,
        name: call.name,
        arguments: invocation.argsSummary,
        risk: invocation.risk,
        invocationId: invocation.id,
      });
      if (decision.tool.approvalPolicy === 'auto' && decision.tool.risk === 'low') {
        await this.executeOne(run, invocation, decision.tool, call.arguments ?? {});
      } else {
        pending.push(invocation);
      }
    }

    if (pending.length) {
      this.deps.runs.transition(run.id, 'waiting_for_approval', {
        pendingToolCallIds: pending.map(p => p.toolCallId),
      });
      this.deps.runs.emit(run.id, 'approval.required', {
        tools: pending.map(p => ({ toolCallId: p.toolCallId, name: p.toolName, risk: p.risk, arguments: p.argsSummary, invocationId: p.id })),
      });
      return 'paused';
    }
    return 'continue';
  }

  private decideTool(run: RunRecord, call: { name: string; arguments: Record<string, unknown> }):
    | { kind: 'allow'; tool: ToolDefinition }
    | { kind: 'reject'; code: string; message: string } {
    const allowed = run.agentSnapshot?.toolPolicy.allowedTools ?? [];
    let tool: ToolDefinition;
    try {
      tool = this.deps.tools.resolve(call.name);
    } catch {
      return { kind: 'reject', code: 'TOOL_UNKNOWN', message: `Unknown tool: ${call.name}` };
    }
    if (!allowed.includes(call.name)) {
      return { kind: 'reject', code: 'TOOL_POLICY_REJECTED', message: `Tool is not enabled for this agent: ${call.name}` };
    }
    try {
      tool.validate(call.arguments ?? {});
    } catch (error) {
      return {
        kind: 'reject',
        code: 'TOOL_ARGUMENTS_INVALID',
        message: error instanceof Error ? error.message : 'Invalid tool arguments',
      };
    }
    return { kind: 'allow', tool };
  }

  /** Execute an approved/auto tool exactly once and append its result message. */
  async executeOne(run: RunRecord, invocation: ToolInvocationRecord, tool: ToolDefinition, args: Record<string, unknown>): Promise<void> {
    if (invocation.status === 'completed') return; // never re-execute
    const call = { id: invocation.toolCallId, name: invocation.toolName, arguments: args };
    this.deps.runs.markToolRunning(run.id, invocation.toolCallId);
    this.deps.runs.emit(run.id, 'tool.started', { toolCallId: call.id, toolName: call.name });
    let result: ToolResult;
    try {
      result = await this.deps.executeApprovedTool(run, tool.name, tool.version, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      this.deps.runs.failTool(run.id, call.id, 'TOOL_EXECUTION_FAILED', message);
      this.appendToolResult(run, call, { ok: false, errorCode: 'TOOL_EXECUTION_FAILED', error: message }, true);
      return;
    }
    if (result.ok) {
      this.deps.runs.completeTool(run.id, call.id, result.output);
      this.appendToolResult(run, call, result, false);
    } else {
      this.deps.runs.failTool(run.id, call.id, result.errorCode ?? 'TOOL_EXECUTION_FAILED', result.error ?? 'Tool failed');
      this.appendToolResult(run, call, result, true);
    }
  }

  private appendToolResult(run: RunRecord, call: { id: string; name: string }, result: ToolResult, isError: boolean): void {
    this.deps.conversations.append(run.workspaceId, run.conversationId, {
      runId: run.id,
      role: 'tool',
      content: JSON.stringify(result),
      metadata: { toolCallId: call.id, toolName: call.name, isError },
    });
  }

  private fallbackSnapshot(run: RunRecord): AgentSnapshot {
    // Defensive: every run is created with a snapshot; this only satisfies types.
    throw new Error(`RUN_NOT_FOUND: Missing agent snapshot for run ${run.id}`);
  }
}

export type { RunEvent, UsageSnapshot, ModelTurn };
