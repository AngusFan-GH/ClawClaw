import { describe, expect, it } from 'vitest';
import { InMemoryClawCoreStore } from '@backend/core/in-memory-store';
import { RunService } from '@backend/core/run-service';
import { SqliteClawCoreStore } from '@backend/core/sqlite-store';

describe('ClawCore RunService', () => {
  it('creates idempotent runs and persists an ordered event log', () => {
    const service = new RunService(new InMemoryClawCoreStore());
    const first = service.create({ workspaceId: 'workspace', conversationId: 'conversation', agentId: 'agent', source: 'chat', idempotencyKey: 'request-1' });
    const retry = service.create({ workspaceId: 'workspace', conversationId: 'conversation', agentId: 'agent', source: 'chat', idempotencyKey: 'request-1' });

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.run.id).toBe(first.run.id);
    expect(service.eventLog(first.run.id).map((event) => event.sequence)).toEqual([1]);
  });

  it('enforces state transitions and records cancellation', () => {
    const service = new RunService(new InMemoryClawCoreStore());
    const { run } = service.create({ workspaceId: 'workspace', conversationId: 'conversation', agentId: 'agent', source: 'chat', idempotencyKey: 'request-2' });
    service.transition(run.id, 'preparing');
    service.transition(run.id, 'streaming');
    const cancelled = service.cancel(run.id);

    expect(cancelled.status).toBe('cancelled');
    expect(service.eventLog(run.id).map((event) => event.type)).toEqual([
      'run.started', 'run.status', 'run.status', 'run.status', 'run.status', 'run.cancelled',
    ]);
  });

  it('persists a run and its event cursor in SQLite', () => {
    const store = new SqliteClawCoreStore(':memory:');
    const service = new RunService(store);
    const { run } = service.create({ workspaceId: 'workspace', conversationId: 'conversation', agentId: 'agent', source: 'schedule', idempotencyKey: 'request-3' });
    service.transition(run.id, 'preparing');

    expect(store.get(run.id)?.status).toBe('preparing');
    expect(service.eventLog(run.id, 1)).toHaveLength(1);
    store.close();
  });
});
