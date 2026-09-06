import { describe, expect, it } from 'vitest';
import { SqliteClawCoreStore } from '@backend/core/sqlite-store';
import { RunService } from '@backend/core/run-service';

describe('ClawCore conversation history', () => {
  it('keeps a conversation isolated, ordered and durable with its run references', () => {
    const store = new SqliteClawCoreStore(':memory:');
    const run = new RunService(store).create({ workspaceId: 'w', conversationId: 'c', agentId: 'a', source: 'chat', idempotencyKey: 'conversation' }).run;
    store.appendMessage({ id: 'first', workspaceId: 'w', conversationId: 'c', runId: run.id, role: 'user', content: 'hello', createdAt: '2026-01-01T00:00:00.000Z' });
    store.appendMessage({ id: 'second', workspaceId: 'w', conversationId: 'c', runId: run.id, role: 'assistant', content: 'hi', createdAt: '2026-01-01T00:00:01.000Z' });
    store.appendMessage({ id: 'other', workspaceId: 'w', conversationId: 'other', role: 'user', content: 'hidden', createdAt: '2026-01-01T00:00:02.000Z' });
    expect(store.listMessages('w', 'c')).toMatchObject([{ content: 'hello', runId: run.id }, { content: 'hi', runId: run.id }]);
    expect(store.listConversations('w')).toMatchObject([{ id: 'other' }, { id: 'c', lastMessagePreview: 'hi' }]);
    store.deleteConversation('w', 'c');
    expect(store.listMessages('w', 'c')).toEqual([]);
    expect(store.get(run.id)).toBeUndefined();
    store.close();
  });
});
