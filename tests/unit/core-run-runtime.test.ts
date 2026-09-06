// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, settled, type Harness, type ModelScript } from './helpers/runtime-harness';
import type { ModelStreamEvent } from '@backend/core/model-adapter';

async function chat(h: Harness, message: string, key = crypto.randomUUID(), agentId?: string) {
  if (!h.rt.providerStore.list('default').length) {
    h.rt.providerStore.create('default', { vendorId: 'ollama', authMode: 'local', model: 'llama' });
  }
  const started = await h.rt.startChat({ workspaceId: 'default', message, idempotencyKey: key, agentId });
  await settled(h.rt, started.run.id);
  return started;
}

const timeScript: ModelScript = ({ turn }) =>
  turn.messages.some(m => m.role === 'tool')
    ? [{ type: 'complete', message: 'time acknowledged', toolCalls: [], stopReason: 'stop' }]
    : [{ type: 'complete', message: '', toolCalls: [{ id: 't1', name: 'core.time.getCurrentTime', arguments: { timezone: 'UTC' } }], stopReason: 'toolUse' }];

const readScript: ModelScript = ({ turn }) =>
  turn.messages.some(m => m.role === 'tool')
    ? [{ type: 'complete', message: 'read acknowledged', toolCalls: [], stopReason: 'stop' }]
    : [{ type: 'complete', message: '', toolCalls: [{ id: 'r1', name: 'core.artifact.readText', arguments: { path: 'note.txt' } }], stopReason: 'toolUse' }];

describe('ClawCore chat run', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness({ script: () => [{ type: 'complete', message: 'hello world', toolCalls: [], stopReason: 'stop' }] });
  });

  it('completes a chat run and persists the ledger + events', async () => {
    const started = await chat(h, 'hi', 'k1');
    expect(started.run.status).not.toBe('failed');
    const run = h.rt.runs.get(started.run.id)!;
    expect(run.status).toBe('completed');
    const events = h.rt.getEvents(run.id).map(e => e.type);
    expect(events).toContain('run.started');
    expect(events).toContain('message.completed');
    expect(events).toContain('run.completed');
    const page = h.rt.getConversation('default', run.conversationId);
    expect(page.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(page.messages[1].content).toBe('hello world');
  });

  it('is idempotent on the idempotency key', async () => {
    const a = await chat(h, 'hi', 'same-key');
    const b = await chat(h, 'again?', 'same-key');
    expect(b.run.id).toBe(a.run.id);
    expect(b.created).toBe(false);
  });

  it('paginates history by stable cursor', async () => {
    h.model.setScript(() => [{ type: 'complete', message: 'ok', toolCalls: [], stopReason: 'stop' }]);
    const started = await chat(h, 'first', 'p1');
    const conv = started.run.conversationId;
    for (let i = 0; i < 3; i++) {
      const s = await h.rt.startChat({ workspaceId: 'default', conversationId: conv, message: `m${i}`, idempotencyKey: `k${i}` });
      await settled(h.rt, s.run.id);
    }
    const first = h.rt.getConversation('default', conv, { limit: 2 });
    expect(first.messages).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const older = h.rt.getConversation('default', conv, { beforeSeq: first.oldestSeq, limit: 2 });
    expect(older.hasMore).toBe(true);
    expect(older.messages[0].seq).toBeLessThan(first.messages[0].seq);
  });
});

describe('auto-approved low-risk tool', () => {
  it('executes getCurrentTime without an approval gate', async () => {
    const h = await makeHarness({ script: timeScript });
    h.rt.providerStore.create('default', { vendorId: 'ollama', authMode: 'local', model: 'llama' });
    const started = await h.rt.startChat({ workspaceId: 'default', message: 'time?', idempotencyKey: 't' });
    await settled(h.rt, started.run.id);
    const run = h.rt.runs.get(started.run.id)!;
    expect(run.status).toBe('completed');
    const inv = h.rt.runs.listToolInvocations(run.id)[0];
    expect(inv.toolName).toBe('core.time.getCurrentTime');
    expect(inv.status).toBe('completed');
    expect(inv.approver).toBeNull();
  });
});

describe('approval gate', () => {
  it('pauses, approves once, then continues (never re-executes)', async () => {
    const h = await makeHarness({ script: readScript });
    h.rt.providerStore.create('default', { vendorId: 'ollama', authMode: 'local', model: 'llama' });
    const started = await h.rt.startChat({ workspaceId: 'default', message: 'read', idempotencyKey: 'r' });
    await new Promise(r => setTimeout(r, 5));
    expect(h.rt.runs.get(started.run.id)?.status).toBe('waiting_for_approval');
    const pending = h.rt.runs.pendingTool(started.run.id)!;
    expect(pending.toolName).toBe('core.artifact.readText');

    const first = await h.rt.resolveToolApproval(started.run.id, 'r1', true);
    expect(first.awaiting).toBe(false);
    // idempotent second approval must not execute again
    const again = await h.rt.resolveToolApproval(started.run.id, 'r1', true);
    expect(again.awaiting).toBe(false);

    await settled(h.rt, started.run.id);
    const run = h.rt.runs.get(started.run.id)!;
    expect(run.status).toBe('completed');
    const inv = h.rt.runs.listToolInvocations(run.id).find(i => i.toolCallId === 'r1')!;
    expect(['completed', 'failed']).toContain(inv.status);
    // exactly one tool result message for the call
    const toolMsgs = h.rt.conversations.listUpTo('default', run.conversationId).filter(m => m.role === 'tool' && (m.metadata as { toolCallId: string })?.toolCallId === 'r1');
    expect(toolMsgs).toHaveLength(1);
  });

  it('does not execute on denial and feeds an error result back', async () => {
    const h = await makeHarness({ script: readScript });
    h.rt.providerStore.create('default', { vendorId: 'ollama', authMode: 'local', model: 'llama' });
    const started = await h.rt.startChat({ workspaceId: 'default', message: 'read', idempotencyKey: 'd' });
    await new Promise(r => setTimeout(r, 5));
    await h.rt.resolveToolApproval(started.run.id, 'r1', false, 'not allowed');
    await settled(h.rt, started.run.id);
    const inv = h.rt.runs.listToolInvocations(started.run.id).find(i => i.toolCallId === 'r1')!;
    expect(inv.status).toBe('denied');
    expect(inv.denialReason).toBe('not allowed');
  });
});

describe('cancellation and budget', () => {
  it('cancels a streaming run', async () => {
    const slow: ModelScript = () =>
      (async function* () {
        await new Promise(r => setTimeout(r, 5000));
        yield { type: 'complete', message: 'late', toolCalls: [], stopReason: 'stop' } as ModelStreamEvent;
      })();
    const h = await makeHarness({ script: slow });
    h.rt.providerStore.create('default', { vendorId: 'ollama', authMode: 'local', model: 'llama' });
    const started = await h.rt.startChat({ workspaceId: 'default', message: 'go', idempotencyKey: 'c' });
    await new Promise(r => setTimeout(r, 20));
    h.rt.cancelRun(started.run.id);
    await settled(h.rt, started.run.id);
    expect(['cancelled', 'stopping']).toContain(h.rt.runs.get(started.run.id)?.status);
  });

  it('fails when the tool-call budget is exceeded', async () => {
    const h = await makeHarness({
      script: () => [{
        type: 'complete', message: '', stopReason: 'toolUse',
        toolCalls: [
          { id: 'a', name: 'core.time.getCurrentTime', arguments: {} },
          { id: 'b', name: 'core.time.getCurrentTime', arguments: {} },
        ],
      }],
    });
    h.rt.providerStore.create('default', { vendorId: 'ollama', authMode: 'local', model: 'llama' });
    h.rt.agents.update('default', 'main', { budget: { maxToolCalls: 1 } });
    const started = await h.rt.startChat({ workspaceId: 'default', message: 'multi', idempotencyKey: 'b1' });
    await settled(h.rt, started.run.id);
    expect(h.rt.runs.get(started.run.id)?.error?.code).toBe('RUN_TOOL_BUDGET_EXCEEDED');
  });
});

describe('restart recovery', () => {
  it('fails interrupted streaming runs but keeps approval-paused runs', async () => {
    const h = await makeHarness({ script: readScript });
    h.rt.providerStore.create('default', { vendorId: 'ollama', authMode: 'local', model: 'llama' });
    const paused = await h.rt.startChat({ workspaceId: 'default', message: 'read', idempotencyKey: 'pause' });
    await new Promise(r => setTimeout(r, 5));
    expect(h.rt.runs.get(paused.run.id)?.status).toBe('waiting_for_approval');

    // a brand new runtime over the same database runs recovery on initialize()
    const { ClawCoreRuntime } = await import('@backend/core/runtime');
    const rt2 = new ClawCoreRuntime({ dataDir: h.dataDir, secretBridge: h.secrets, model: h.model, bundledSkillsRoot: `${h.dataDir}/skills` });
    const result = rt2.runs.recoverInterrupted();
    expect(result.failedRuns).toBe(0); // the paused run is preserved, not failed
    expect(rt2.runs.get(paused.run.id)?.status).toBe('waiting_for_approval');
    rt2.close();
    h.rt.close();
  });
});
