import { SqliteClawCoreStore } from './sqlite-store';
import { PiModelAdapter } from './pi-model-adapter';
import { CoreProviderResolver } from './provider-resolver';
import { CoreProviderStore } from './provider-store';
import { RunEngine } from './run-engine';
import { RunService } from './run-service';
import { MutableCancellationSignal } from './model-adapter';
import { randomUUID } from 'node:crypto';
import { CoreCronStore } from './cron-store';
import { CoreScheduler } from './scheduler';
import type { RunEvent } from './contracts';
import { CoreAgentStore } from './agent-store';
import { CoreSkillStore } from './skill-store';
import { CoreArtifactStore } from './artifact-store';

/** Process-local ClawCore composition root. External runtimes never enter it. */
export class ClawCoreRuntime {
  readonly store: SqliteClawCoreStore;
  readonly runs: RunService;
  readonly providerStore: CoreProviderStore;
  readonly providers: CoreProviderResolver;
  readonly engine: RunEngine;
  readonly cron = new CoreCronStore();
  readonly scheduler: CoreScheduler;
  readonly agents = new CoreAgentStore();
  readonly skills = new CoreSkillStore();
  readonly artifacts = new CoreArtifactStore();
  private readonly activeSignals = new Map<string, MutableCancellationSignal>();
  private readonly resumableTurns = new Map<string, { model: import('./model-adapter').ModelTurn['model']; systemPrompt?: string }>();

  constructor(onEvent?: (event: RunEvent) => void) {
    this.store = new SqliteClawCoreStore();
    this.providerStore = new CoreProviderStore();
    this.providers = new CoreProviderResolver(this.providerStore);
    this.runs = new RunService(this.store, (event) => {
      if (event.type === 'message.completed') {
        const run = this.runs.get(event.runId);
        const text = typeof (event.payload as { text?: unknown }).text === 'string' ? (event.payload as { text: string }).text : '';
        if (run && text) this.store.appendMessage({ id: randomUUID(), workspaceId: run.workspaceId, conversationId: run.conversationId, runId: run.id, role: 'assistant', content: text, createdAt: event.occurredAt });
      }
      onEvent?.(event);
    });
    this.engine = new RunEngine(this.runs, new PiModelAdapter());
    this.scheduler = new CoreScheduler(() => this.cron.list(), id => this.triggerCron(id));
    this.scheduler.start();
  }

  async initialize(): Promise<void> { await this.providerStore.initializeSecrets(); }

  async startChat(input: {
    workspaceId: string; conversationId: string; agentId: string; message: string;
    idempotencyKey: string; providerAccountId?: string; systemPrompt?: string;
  }) {
    const created = this.runs.create({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      agentId: input.agentId,
      source: 'chat',
      idempotencyKey: input.idempotencyKey,
    });
    if (!created.created) return created;
    const model = await this.providers.resolve(input.providerAccountId);
    this.store.appendMessage({ id: randomUUID(), workspaceId: input.workspaceId, conversationId: input.conversationId, runId: created.run.id, role: 'user', content: input.message, createdAt: new Date().toISOString() });
    const signal = new MutableCancellationSignal();
    this.resumableTurns.set(created.run.id, { model, systemPrompt: input.systemPrompt });
    this.activeSignals.set(created.run.id, signal);
    void this.engine.execute({
      runId: created.run.id,
      model,
      systemPrompt: input.systemPrompt,
      messages: this.buildContext(input.workspaceId, input.conversationId),
    }, signal).finally(() => this.activeSignals.delete(created.run.id));
    return created;
  }
  cancelRun(runId: string, reason?: string) {
    this.activeSignals.get(runId)?.abort();
    return this.runs.cancel(runId, reason);
  }
  async resolveToolApproval(runId: string, approved: boolean): Promise<void> {
    const run = this.runs.get(runId); if (!run || run.status !== 'waiting_for_approval') throw new Error('Run is not waiting for tool approval');
    const request = this.runs.eventLog(runId).slice().reverse().find(event => event.type === 'tool.requested');
    const tool = request?.payload as { id?: string; name?: string; arguments?: Record<string, unknown> } | undefined;
    if (!tool?.name) throw new Error('Tool request is missing');
    this.runs.emitCoreEvent(runId, approved ? 'tool.approved' : 'tool.denied', { toolCallId: tool.id, toolName: tool.name });
    if (!approved) { this.runs.fail(runId, { code: 'TOOL_DENIED', message: `Tool ${tool.name} was denied` }); return; }
    this.runs.emitCoreEvent(runId, 'tool.started', { toolCallId: tool.id, toolName: tool.name });
    const result = tool.name === 'context.getTime' ? new Date().toISOString() : `Tool ${tool.name} is not permitted by the local sandbox`;
    this.store.appendMessage({ id: randomUUID(), workspaceId: run.workspaceId, conversationId: run.conversationId, runId, role: 'tool', content: result, createdAt: new Date().toISOString(), metadata: { toolCallId: tool.id, toolName: tool.name } });
    this.runs.emitCoreEvent(runId, 'tool.completed', { toolCallId: tool.id, toolName: tool.name, result });
    const turn = this.resumableTurns.get(runId); if (!turn) { this.runs.fail(runId, { code: 'TOOL_RESUME_UNAVAILABLE', message: 'The approved tool cannot be resumed after restart' }); return; }
    this.runs.transition(runId, 'streaming'); const signal = new MutableCancellationSignal(); this.activeSignals.set(runId, signal);
    void this.engine.execute({ runId, ...turn, messages: this.buildContext(run.workspaceId, run.conversationId) }, signal).finally(() => this.activeSignals.delete(runId));
  }
  getConversation(workspaceId: string, conversationId: string) { return this.store.listMessages(workspaceId, conversationId); }
  listConversations(workspaceId: string) { return this.store.listConversations(workspaceId); }
  deleteConversation(workspaceId: string, conversationId: string): void { this.store.deleteConversation(workspaceId, conversationId); }
  async triggerCron(id: string) { const job = this.cron.get(id); if (!job) throw new Error('Cron job not found'); const run = await this.startChat({ workspaceId: 'default', conversationId: job.sessionTarget || `cron:${id}`, agentId: job.agentId || 'main', message: job.message, idempotencyKey: `cron:${id}:${Date.now()}` }); this.cron.save({ ...job, lastRun: { time: new Date().toISOString(), success: true } }); return run; }
  private buildContext(workspaceId: string, conversationId: string) {
    const all = this.store.listMessages(workspaceId, conversationId, 400);
    const recent = all.slice(-80);
    const older = all.slice(0, -80);
    if (!older.length) return recent;
    const digest = older.map(message => `${message.role}: ${message.content}`).join('\n').slice(-12_000);
    return [{ id: 'memory-summary', conversationId, role: 'system' as const, content: `Conversation memory (compressed):\n${digest}`, createdAt: new Date(0).toISOString() }, ...recent];
  }
  close(): void { this.scheduler.stop(); this.cron.close(); this.skills.close(); this.agents.close(); this.providerStore.close(); this.store.close(); }
}
