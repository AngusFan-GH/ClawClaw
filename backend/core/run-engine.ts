import type { RunEvent, UsageSnapshot } from './contracts';
import type { ModelAdapter, ModelCancellationSignal, ModelTurn } from './model-adapter';
import { RunService } from './run-service';

export interface ExecuteRunInput extends ModelTurn {
  runId: string;
}

export type CancellationSignal = ModelCancellationSignal;

/**
 * Deterministic single-turn execution kernel. Tool continuation is deliberately
 * outside this class: it will consume persisted `tool.requested` events after
 * approval, preventing a model stream from bypassing policy enforcement.
 */
export class RunEngine {
  constructor(private readonly runs: RunService, private readonly models: ModelAdapter) {}

  async execute(input: ExecuteRunInput, signal: CancellationSignal = { aborted: false }): Promise<void> {
    const initial = this.runs.get(input.runId);
    if (!initial) throw new Error(`Run not found: ${input.runId}`);
    if (initial.turnCount >= initial.budget.maxTurns) {
      this.runs.fail(input.runId, { code: 'RUN_TURN_BUDGET_EXCEEDED', message: 'Run turn budget exhausted before model execution' });
      return;
    }
    const deadline = Date.now() + initial.budget.maxWallTimeMs;
    this.runs.incrementTurn(input.runId);
    if (initial.status === 'queued') {
      this.runs.transition(input.runId, 'preparing');
      this.runs.transition(input.runId, 'streaming');
    }
    let completed = false;

    try {
      for await (const event of this.models.stream(input, signal)) {
        if (Date.now() > deadline) {
          this.runs.fail(input.runId, { code: 'RUN_TIME_BUDGET_EXCEEDED', message: 'Run exceeded its wall-time budget' });
          return;
        }
        if (signal.aborted) {
          this.runs.cancel(input.runId, 'Cancelled by caller');
          return;
        }
        switch (event.type) {
          case 'text.delta':
            this.append(input.runId, 'message.delta', { text: event.text });
            break;
          case 'reasoning.delta':
            this.append(input.runId, 'reasoning.delta', { text: event.text });
            break;
          case 'usage':
            if (event.usage.outputTokens > initial.budget.maxOutputTokens) {
              this.runs.fail(input.runId, { code: 'RUN_OUTPUT_BUDGET_EXCEEDED', message: 'Model output exceeded the configured token budget' });
              return;
            }
            this.append(input.runId, 'usage.updated', event.usage);
            break;
          case 'tool.call':
            if (this.runs.incrementToolCall(input.runId).toolCallCount > initial.budget.maxToolCalls) {
              this.runs.fail(input.runId, { code: 'RUN_TOOL_BUDGET_EXCEEDED', message: 'Run tool-call budget exhausted' });
              return;
            }
            this.append(input.runId, 'tool.requested', event);
            this.runs.transition(input.runId, 'waiting_for_approval', { toolCallId: event.id, toolName: event.name });
            return;
          case 'complete':
            this.append(input.runId, 'message.completed', { text: event.message });
            this.runs.transition(input.runId, 'completed');
            completed = true;
            return;
          case 'error':
            this.runs.fail(input.runId, event);
            return;
        }
      }
      if (!completed) this.runs.fail(input.runId, { code: 'MODEL_STREAM_ENDED', message: 'Model stream ended without completion' });
    } catch (error) {
      this.runs.fail(input.runId, { code: 'MODEL_EXECUTION_FAILED', message: error instanceof Error ? error.message : String(error) });
    }
  }

  private append(runId: string, type: RunEvent['type'], payload: UsageSnapshot | Record<string, unknown>): void {
    this.runs.emitCoreEvent(runId, type, payload);
  }
}
