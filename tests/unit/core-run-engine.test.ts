import { describe, expect, it } from 'vitest';
import { InMemoryClawCoreStore } from '@backend/core/in-memory-store';
import type { ModelAdapter, ModelStreamEvent, ModelTurn } from '@backend/core/model-adapter';
import { RunEngine } from '@backend/core/run-engine';
import { RunService } from '@backend/core/run-service';
import { MutableCancellationSignal } from '@backend/core/model-adapter';

class FixtureAdapter implements ModelAdapter {
  constructor(private readonly events: ModelStreamEvent[]) {}
  async *stream(_turn: ModelTurn): AsyncIterable<ModelStreamEvent> { yield* this.events; }
}

function createRun() {
  const runs = new RunService(new InMemoryClawCoreStore());
  return { runs, run: runs.create({ workspaceId: 'w', conversationId: 'c', agentId: 'a', source: 'chat', idempotencyKey: crypto.randomUUID() }).run };
}

describe('ClawCore RunEngine', () => {
  it('persists streaming model output and completes a run', async () => {
    const { runs, run } = createRun();
    const engine = new RunEngine(runs, new FixtureAdapter([{ type: 'text.delta', text: 'Hello' }, { type: 'usage', usage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 0 } }, { type: 'complete', message: 'Hello' }]));
    await engine.execute({ runId: run.id, model: { provider: 'fixture', id: 'test' }, messages: [{ role: 'user', content: 'Hi' }] });
    expect(runs.eventLog(run.id).map((item) => item.type)).toEqual(['run.started', 'run.status', 'run.status', 'message.delta', 'usage.updated', 'message.completed', 'run.status', 'run.completed']);
  });

  it('pauses instead of running a model-requested tool directly', async () => {
    const { runs, run } = createRun();
    const engine = new RunEngine(runs, new FixtureAdapter([{ type: 'tool.call', id: 'call-1', name: 'shell', arguments: { command: 'whoami' } }]));
    await engine.execute({ runId: run.id, model: { provider: 'fixture', id: 'test' }, messages: [{ role: 'user', content: 'Hi' }] });
    expect(runs.eventLog(run.id).at(-1)?.type).toBe('run.status');
  });

  it('cancels a running stream before it emits output', async () => {
    const { runs, run } = createRun();
    const signal = new MutableCancellationSignal(); signal.abort();
    const engine = new RunEngine(runs, new FixtureAdapter([{ type: 'text.delta', text: 'must not persist' }]));
    await engine.execute({ runId: run.id, model: { provider: 'fixture', id: 'test' }, messages: [{ role: 'user', content: 'Hi' }] }, signal);
    expect(runs.eventLog(run.id).map(event => event.type)).not.toContain('message.delta');
    expect(runs.get(run.id)?.status).toBe('cancelled');
  });

  it('enforces the tool-call and output-token budgets', async () => {
    const { runs, run } = createRun();
    const limited = runs.create({ workspaceId: 'w', conversationId: 'limited', agentId: 'a', source: 'chat', idempotencyKey: crypto.randomUUID(), budget: { maxToolCalls: 0 } }).run;
    const engine = new RunEngine(runs, new FixtureAdapter([{ type: 'tool.call', id: 'call-1', name: 'shell', arguments: {} }]));
    await engine.execute({ runId: limited.id, model: { provider: 'fixture', id: 'test' }, messages: [{ role: 'user', content: 'Hi' }] });
    expect(runs.get(limited.id)?.error?.code).toBe('RUN_TOOL_BUDGET_EXCEEDED');
    const outputEngine = new RunEngine(runs, new FixtureAdapter([{ type: 'usage', usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0 } }]));
    const output = runs.create({ workspaceId: 'w', conversationId: 'output', agentId: 'a', source: 'chat', idempotencyKey: crypto.randomUUID(), budget: { maxOutputTokens: 1 } }).run;
    await outputEngine.execute({ runId: output.id, model: { provider: 'fixture', id: 'test' }, messages: [{ role: 'user', content: 'Hi' }] });
    expect(runs.get(output.id)?.error?.code).toBe('RUN_OUTPUT_BUDGET_EXCEEDED');
    expect(run.status).toBe('queued');
  });
});
