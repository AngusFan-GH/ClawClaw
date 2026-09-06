/**
 * Deterministic context planning.
 *
 * The plan records every section, token estimate and trim reason so a run is
 * auditable. Older history is represented by a real persisted summary (with a
 * source cursor range) or dropped as whole messages — content is never sliced
 * mid-string to fit a budget.
 */
import type { AgentSnapshot, ContextPlan } from '../contracts';
import type { ModelChatMessage } from '../model-adapter';
import type { ConversationStore } from '../conversation-store';
import type { MemoryStore } from '../memory-store';
import { estimateTokens } from '../util';

export interface SkillInstruction {
  id: string;
  name: string;
  instruction: string;
}

export interface PlannerDeps {
  conversations: ConversationStore;
  memories: MemoryStore;
}

export interface PlannedContext {
  plan: ContextPlan;
  systemPrompt: string;
  messages: ModelChatMessage[];
}

export class ContextPlanner {
  constructor(private readonly deps: PlannerDeps) {}

  build(opts: {
    workspaceId: string;
    conversationId: string;
    snapshot: AgentSnapshot;
    upToSeq?: number;
    skills?: SkillInstruction[];
    memoryQuery?: string;
  }): PlannedContext {
    const { workspaceId, conversationId, snapshot, upToSeq, skills = [], memoryQuery } = opts;
    const trimReasons: string[] = [];

    const summary = this.deps.memories.latestSummary(workspaceId, conversationId);
    const allMessages = this.deps.conversations.listUpTo(workspaceId, conversationId, upToSeq, 4000)
      .filter(m => m.role !== 'system');
    const firstRecentSeq = summary ? summary.cursorEndSeq + 1 : 1;
    let recent = allMessages.filter(m => m.seq >= firstRecentSeq);
    if (summary && recent.length === allMessages.length && allMessages.length > 0) {
      // ensure boundary respected when seq alignment is off
      recent = allMessages.filter(m => m.seq > summary.cursorEndSeq);
    }

    const memories = snapshot.memoryPolicy.enabled && memoryQuery
      ? this.deps.memories.search(workspaceId, memoryQuery, snapshot.memoryPolicy.maxItems)
      : [];

    const systemParts: string[] = [];
    if (snapshot.systemPrompt.trim()) systemParts.push(snapshot.systemPrompt.trim());
    if (skills.length) {
      systemParts.push(`# Active skills\n${skills.map(s => `## ${s.name}\n${s.instruction}`).join('\n\n')}`);
    }
    const toolNames = snapshot.toolPolicy.allowedTools;
    if (toolNames.length) systemParts.push(`# Available tools (require approval unless marked auto): ${toolNames.join(', ')}`);
    const systemPrompt = systemParts.join('\n\n');

    const summarySection = summary
      ? [{ version: summary.version, content: summary.content, cursorStartSeq: summary.cursorStartSeq, cursorEndSeq: summary.cursorEndSeq }]
      : [];

    // Deterministic whole-message trimming against the input token budget.
    const reserve = estimateTokens(systemPrompt) + (summary ? estimateTokens(summary.content) : 0)
      + memories.reduce((n, m) => n + estimateTokens(m.content), 0) + 64;
    // Honor the configured input budget; keep at least the final two messages.
    const budget = Math.max(0, snapshot.budget.maxInputTokens - reserve);
    let used = recent.reduce((n, m) => n + estimateTokens(m.content), 0);
    while (recent.length > 2 && used > budget) {
      const removed = recent.shift()!;
      used -= estimateTokens(removed.content);
      trimReasons.push(`input_budget:dropped_message_seq_${removed.seq}`);
    }

    const tokenEstimates = {
      systemPrompt: estimateTokens(systemPrompt),
      skills: skills.reduce((n, s) => n + estimateTokens(s.instruction), 0),
      summaries: summary ? estimateTokens(summary.content) : 0,
      memories: memories.reduce((n, m) => n + estimateTokens(m.content), 0),
      recentMessages: used,
      total: reserve + used,
      budget: snapshot.budget.maxInputTokens,
    };

    const plan: ContextPlan = {
      sections: {
        systemPrompt,
        skills,
        summaries: summarySection,
        memories: memories.map(m => ({ id: m.id, content: m.content })),
        recentMessages: recent,
      },
      tokenEstimates,
      trimReasons,
    };

    const messages: PlannedContext['messages'] = [];
    for (const m of recent) {
      if (m.role === 'user') {
        messages.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        const toolCalls = (m.metadata?.toolCalls as ModelChatMessage['toolCalls']) ?? undefined;
        messages.push({ role: 'assistant', content: m.content, toolCalls });
      } else if (m.role === 'tool') {
        messages.push({
          role: 'tool',
          content: m.content,
          toolCallId: m.metadata?.toolCallId as string | undefined,
          toolName: m.metadata?.toolName as string | undefined,
          isError: Boolean(m.metadata?.isError),
        });
      }
    }
    return { plan, systemPrompt, messages };
  }
}
