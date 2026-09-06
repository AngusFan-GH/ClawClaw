// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { CoreDatabase } from '@backend/core/db/database';
import { MemoryStore } from '@backend/core/memory-store';
import { ConversationStore } from '@backend/core/conversation-store';
import { ContextPlanner } from '@backend/core/context/planner';
import { DEFAULT_MEMORY_POLICY, DEFAULT_RUN_BUDGET, DEFAULT_TOOL_POLICY, type AgentSnapshot } from '@backend/core/contracts';
import { tempDir } from './helpers/runtime-harness';

function setup() {
  const db = new CoreDatabase(join(tempDir(), 'c.sqlite'));
  return { db, memory: new MemoryStore(db), conversations: new ConversationStore(db) };
}

const snapshot: AgentSnapshot = {
  id: 'main', name: 'Main', systemPrompt: 'system', providerId: null, model: null,
  toolPolicy: DEFAULT_TOOL_POLICY, memoryPolicy: DEFAULT_MEMORY_POLICY, budget: DEFAULT_RUN_BUDGET, enabledSkillIds: [],
};

describe('MemoryStore keyword search', () => {
  it('finds items by FTS keyword and isolates workspaces', () => {
    const t = setup();
    t.memory.add('default', { content: 'Project deadline is Friday', tags: ['plan'] });
    t.memory.add('default', { content: 'Coffee preferences: oat milk flat white' });
    t.memory.add('other', { content: 'Project secret in other workspace' });

    const hits = t.memory.search('default', 'project deadline', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toContain('Friday');
    expect(t.memory.search('other', 'project')).toHaveLength(1);
    expect(t.memory.search('default', 'zzznope')).toHaveLength(0);
  });

  it('updates and deletes', () => {
    const t = setup();
    const m = t.memory.add('default', { content: 'remember this' });
    t.memory.update('default', m.id, { content: 'remember that' });
    expect(t.memory.search('default', 'that')).toHaveLength(1);
    t.memory.delete('default', m.id);
    expect(t.memory.list('default')).toHaveLength(0);
  });
});

describe('conversation summaries', () => {
  it('versions summaries with an exact source cursor range', () => {
    const t = setup();
    t.memory.addSummary('default', { conversationId: 'c', cursorStartSeq: 1, cursorEndSeq: 4, tokenEstimate: 30, content: 'sum v1' });
    t.memory.addSummary('default', { conversationId: 'c', cursorStartSeq: 5, cursorEndSeq: 8, tokenEstimate: 20, content: 'sum v2' });
    const latest = t.memory.latestSummary('default', 'c')!;
    expect(latest.version).toBe(2);
    expect(latest.cursorEndSeq).toBe(8);
    t.memory.invalidate('default', 'c');
    expect(t.memory.latestSummary('default', 'c')).toBeUndefined();
  });
});

describe('ContextPlanner', () => {
  it('uses the summary instead of covered messages and records estimates', () => {
    const t = setup();
    t.memory.addSummary('default', { conversationId: 'c', cursorStartSeq: 1, cursorEndSeq: 2, tokenEstimate: 5, content: 'EARLIER SUMMARY' });
    t.conversations.append('default', 'c', { role: 'user', content: 'old user' }); // seq1
    t.conversations.append('default', 'c', { role: 'assistant', content: 'old assistant' }); // seq2
    t.conversations.append('default', 'c', { role: 'user', content: 'recent question' }); // seq3

    const planner = new ContextPlanner({ conversations: t.conversations, memories: t.memory });
    const planned = planner.build({ workspaceId: 'default', conversationId: 'c', snapshot });
    expect(planned.plan.sections.summaries?.[0]?.content).toBe('EARLIER SUMMARY');
    const contents = planned.messages.map(m => m.content);
    expect(contents).not.toContain('old user');
    expect(contents).toContain('recent question');
    expect(planned.plan.tokenEstimates.total).toBeGreaterThan(0);
    expect(planned.systemPrompt.startsWith('system')).toBe(true);
  });

  it('drops whole messages (never slices text) and records trim reasons', () => {
    const t = setup();
    const tight: AgentSnapshot = { ...snapshot, budget: { ...DEFAULT_RUN_BUDGET, maxInputTokens: 40 } };
    for (let i = 0; i < 8; i++) t.conversations.append('default', 'c', { role: 'user', content: `message number ${i} with some text` });
    const planner = new ContextPlanner({ conversations: t.conversations, memories: t.memory });
    const planned = planner.build({ workspaceId: 'default', conversationId: 'c', snapshot: tight });
    // every included message is intact (full content), some were dropped with reasons
    for (const m of planned.messages) expect(m.content.startsWith('message number')).toBe(true);
    expect(planned.plan.trimReasons.length).toBeGreaterThan(0);
    expect(planned.plan.trimReasons[0]).toMatch(/input_budget:dropped_message_seq/);
  });
});
