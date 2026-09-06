/**
 * Process-local ClawCore composition root.
 *
 * Owns the single SQLite connection, the OS-keychain-backed credentials, the
 * agent/tool/memory/channel/schedule subsystems and their lifecycle. No
 * Electron/OpenClaw/Gateway object is reachable from here.
 */
import { join } from 'node:path';
import { CoreDatabase, resolveDataDir } from './db/database';
import { NativeSecretBridge, type SecretBridge } from './native/secret-bridge';
import { Keychain } from './secrets/keychain';
import { ProviderStore } from './provider-store';
import { CoreProviderResolver } from './provider-resolver';
import { ProviderValidator, type FetchLike } from './provider-validation';
import { AgentStore, type AgentView, type ChannelBinding } from './agent-store';
import { ConversationStore } from './conversation-store';
import { RunRepository } from './run-repository';
import { RunService } from './run-service';
import { MemoryStore } from './memory-store';
import { ContextPlanner } from './context/planner';
import { CoreSkillStore } from './skill-store';
import { ArtifactStore } from './artifact-store';
import { ToolRegistry } from './tools/registry';
import type { ToolDefinition } from './tools/types';
import { ChannelService } from './channels/channel-service';
import { defaultChannelRegistry } from './channels/adapters';
import { CoreCronStore } from './cron-store';
import { CoreScheduler } from './scheduler';
import { RunEngine, type BuiltTurn } from './run-engine';
import { PiModelAdapter } from './pi-model-adapter';
import { resourcesPath } from '../host/desktop';
import type { ModelAdapter } from './model-adapter';
import { MutableCancellationSignal } from './model-adapter';
import {
  type AgentSnapshot,
  type RunEvent,
  type RunRecord,
  DEFAULT_MEMORY_POLICY,
  DEFAULT_RUN_BUDGET,
  DEFAULT_TOOL_POLICY,
} from './contracts';
import { estimateTokens, isoNow, newId } from './util';
import type { ToolResult } from './tools/types';

export interface RuntimeOptions {
  dataDir?: string;
  databasePath?: string;
  secretBridge?: SecretBridge;
  fetchImpl?: FetchLike;
  bundledSkillsRoot?: string;
  model?: ModelAdapter;
  onEvent?: (event: RunEvent) => void;
}

export interface StartChatInput {
  workspaceId?: string;
  conversationId?: string;
  agentId?: string | null;
  message: string;
  idempotencyKey: string;
  source?: RunRecord['source'];
  attachments?: string[];
  channel?: { accountId: string; sourceId: string; sender?: string };
}

export class ClawCoreRuntime {
  readonly db: CoreDatabase;
  readonly keychain: Keychain;
  readonly providerStore: ProviderStore;
  readonly providers: CoreProviderResolver;
  readonly providerValidator: ProviderValidator;
  readonly agents: AgentStore;
  readonly conversations: ConversationStore;
  readonly runRepo: RunRepository;
  readonly runs: RunService;
  readonly memory: MemoryStore;
  readonly planner: ContextPlanner;
  readonly skills: CoreSkillStore;
  readonly artifacts: ArtifactStore;
  readonly tools: ToolRegistry;
  readonly channels: ChannelService;
  readonly cron: CoreCronStore;
  private readonly scheduler: CoreScheduler;
  private readonly engine: RunEngine;
  private readonly model: ModelAdapter;
  private readonly signals = new Map<string, MutableCancellationSignal>();
  private readonly settled = new Map<string, Promise<void>>();

  constructor(options: RuntimeOptions = {}) {
    const dataDir = resolveDataDir(options.dataDir);
    this.db = new CoreDatabase(options.databasePath ?? join(dataDir, 'clawcore.sqlite'));
    this.keychain = new Keychain(options.secretBridge ?? new NativeSecretBridge());
    this.providerStore = new ProviderStore(this.db, this.keychain);
    this.providers = new CoreProviderResolver(this.providerStore);
    this.providerValidator = new ProviderValidator(options.fetchImpl ?? globalThis.fetch);
    this.agents = new AgentStore(this.db);
    this.conversations = new ConversationStore(this.db);
    this.runRepo = new RunRepository(this.db);
    this.runs = new RunService(this.runRepo, options.onEvent);
    this.memory = new MemoryStore(this.db);
    this.planner = new ContextPlanner({ conversations: this.conversations, memories: this.memory });
    this.skills = new CoreSkillStore(this.db, dataDir, options.bundledSkillsRoot ?? join(resourcesPath, 'skills'));
    this.artifacts = new ArtifactStore(this.db, dataDir);
    this.tools = new ToolRegistry();
    this.channels = new ChannelService(this.db, this.keychain, defaultChannelRegistry(options.fetchImpl), {
      agentIdFor: (workspaceId, channelType, accountId) => this.agentForChannel(workspaceId, channelType, accountId),
      unbindAccount: (workspaceId, accountId) => this.agents.unbindAccount(workspaceId, accountId),
    });
    this.cron = new CoreCronStore(this.db);
    this.model = options.model ?? new PiModelAdapter();
    this.engine = new RunEngine({
      runs: this.runs,
      conversations: this.conversations,
      tools: this.tools,
      model: this.model,
      signalFor: runId => this.signals.get(runId) ?? { aborted: false },
      buildTurn: (run, snapshot) => this.buildTurn(run, snapshot),
      executeApprovedTool: (run, name, version, args) => this.executeApprovedTool(run, name, version, args),
      afterRun: run => this.afterRun(run),
    });
    this.scheduler = new CoreScheduler(() => this.tickCron());
  }

  async initialize(): Promise<{ secretMigration: { migrated: number; pending: number } }> {
    this.channels.setRunStarter((workspaceId, req) =>
      this.startChat({
        workspaceId,
        agentId: req.agentId,
        message: req.text,
        source: 'channel',
        idempotencyKey: `channel:${req.accountId}:${req.sourceId}`,
        channel: { accountId: req.accountId, sourceId: req.sourceId, sender: req.sender },
      }).then(r => ({ runId: r.run.id, conversationId: r.run.conversationId })),
    );
    this.runs.recoverInterrupted();
    const secretMigration = await this.providerStore.migrateLegacySecrets();
    this.scheduler.start();
    return { secretMigration };
  }

  // ---- Chat ---------------------------------------------------------------

  async startChat(input: StartChatInput): Promise<{ run: RunRecord; created: boolean }> {
    const workspaceId = input.workspaceId ?? 'default';
    if (!input.message?.trim()) throw Object.assign(new Error('INVALID_ARGUMENT: Message is required'), { code: 'INVALID_ARGUMENT' });
    const agentId = this.agents.resolveAgentId(workspaceId, input.agentId);
    const agent = this.agents.require(workspaceId, agentId);
    const conversationId = input.conversationId ?? (input.channel ? `channel:${input.channel.accountId}:${input.channel.sourceId}` : newId());
    const snapshot = this.snapshot(agent);

    const { run, created } = this.db.transaction(() => {
      const createdRun = this.runs.create({
        workspaceId,
        conversationId,
        agentId,
        source: input.source ?? 'chat',
        idempotencyKey: input.idempotencyKey,
        agentSnapshot: snapshot,
      });
      if (createdRun.created) {
        this.conversations.ensure(workspaceId, conversationId);
        if (input.attachments?.length) this.conversations.linkArtifacts(workspaceId, conversationId, null, input.attachments);
        this.conversations.append(workspaceId, conversationId, {
          role: 'user',
          content: input.message,
          artifactIds: input.attachments,
        });
      }
      return createdRun;
    });

    if (created) {
      const signal = new MutableCancellationSignal();
      this.signals.set(run.id, signal);
      const promise = this.engine.run(run.id).catch(error => {
        this.runs.fail(run.id, { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Run failed' });
      }).finally(() => {
        this.signals.delete(run.id);
        this.settled.delete(run.id);
      });
      this.settled.set(run.id, promise);
    }
    return { run, created };
  }

  cancelRun(runId: string, reason?: string): RunRecord {
    this.signals.get(runId)?.abort();
    return this.runs.cancel(runId, reason);
  }

  async resolveToolApproval(runId: string, toolCallId: string, approved: boolean, reason?: string, approver = 'user'): Promise<{ awaiting: boolean }> {
    const run = this.runs.requireRun(runId);
    if (run.status !== 'waiting_for_approval') {
      // Idempotent: if already resolved, report current pending state.
      return { awaiting: Boolean(this.runs.pendingTool(runId)) };
    }
    if (approved) {
      this.runs.approve(runId, toolCallId, approver);
    } else {
      this.runs.deny(runId, toolCallId, reason || 'Denied by user', approver);
      this.conversations.append(run.workspaceId, run.conversationId, {
        runId, role: 'tool', content: JSON.stringify({ ok: false, errorCode: 'TOOL_DENIED', error: reason || 'Denied by user' }),
        metadata: { toolCallId, toolName: this.toolName(runId, toolCallId), isError: true },
      });
    }

    const pending = this.runRepo.listToolInvocations(runId).filter(inv => inv.status === 'requested');
    if (pending.length) return { awaiting: true };

    // All resolved: execute the approved calls once, then continue.
    for (const inv of this.runRepo.listToolInvocations(runId).filter(inv => inv.status === 'approved')) {
      const def = this.tools.resolve(inv.toolName, inv.toolVersion);
      const args = this.originalArgs(runId, inv.toolCallId);
      await this.engine.executeOne(run, inv, def, args);
    }

    if (!isTerminalView(run.status)) {
      this.runs.transition(runId, 'streaming');
      const signal = new MutableCancellationSignal();
      this.signals.set(runId, signal);
      const promise = this.engine.run(runId).catch(error => {
        this.runs.fail(runId, { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Run failed' });
      }).finally(() => {
        this.signals.delete(runId);
        this.settled.delete(runId);
      });
      this.settled.set(runId, promise);
    }
    return { awaiting: false };
  }

  whenSettled(runId: string): Promise<void> {
    return this.settled.get(runId) ?? Promise.resolve();
  }

  getEvents(runId: string, afterSequence?: number) {
    return this.runs.eventLog(runId, afterSequence);
  }

  listConversations(workspaceId = 'default') {
    return this.conversations.listConversations(workspaceId);
  }

  getConversation(workspaceId: string, conversationId: string, opts?: { beforeSeq?: number; limit?: number }) {
    return this.conversations.page(workspaceId, conversationId, opts);
  }

  deleteConversation(workspaceId: string, conversationId: string): void {
    this.conversations.deleteConversation(workspaceId, conversationId);
  }

  // ---- Provider validation ------------------------------------------------

  async validateProvider(workspaceId: string, id: string) {
    const row = this.providerStore.requireRow(workspaceId, id);
    const secret = await this.providerStore.getSecret(workspaceId, id);
    return this.providerValidator.validate(row, secret);
  }

  // ---- Cron ---------------------------------------------------------------

  async triggerCron(workspaceId: string, id: string): Promise<RunRecord> {
    const job = this.cron.require(workspaceId, id);
    const started = await this.startChat({
      workspaceId,
      agentId: job.agentId,
      conversationId: job.sessionTarget || `cron:${job.id}`,
      message: job.message,
      source: 'schedule',
      idempotencyKey: `cron:${job.id}:manual:${isoNow()}`,
    });
    return started.run;
  }

  private async tickCron(): Promise<void> {
    const due = this.cron.claimDue(new Date());
    await Promise.all(due.map(async ({ job, scheduledAt }) => {
      try {
        const started = await this.startChat({
          workspaceId: job.workspaceId,
          agentId: job.agentId,
          conversationId: job.sessionTarget || `cron:${job.id}`,
          message: job.message,
          source: 'schedule',
          idempotencyKey: `cron:${job.id}:${scheduledAt}`,
        });
        if (!started.created) {
          this.cron.recordFireResult(job.id, scheduledAt, started.run.id, 'success');
          return;
        }
        await this.whenSettled(started.run.id);
        const terminal = this.runs.get(started.run.id);
        const ok = terminal?.status === 'completed';
        this.cron.recordFireResult(job.id, scheduledAt, started.run.id, ok ? 'success' : 'error', ok ? undefined : terminal?.error?.message ?? terminal?.status);
        if (ok && job.delivery?.accountId) {
          const text = this.lastAssistantText(job.workspaceId, started.run.conversationId);
          if (text) await this.channels.send(job.workspaceId, job.delivery.accountId, text).catch(() => undefined);
        }
      } catch (error) {
        this.cron.recordFireResult(job.id, scheduledAt, null, 'error', error instanceof Error ? error.message : 'scheduled run failed');
      }
    }));
  }

  // ---- Internals ----------------------------------------------------------

  private snapshot(agent: AgentView): AgentSnapshot {
    const enabledSkills = this.skills.list(agent.workspaceId).filter(s => s.enabled).map(s => s.slug);
    return {
      id: agent.id,
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      providerId: agent.providerId ?? null,
      model: agent.model ?? null,
      toolPolicy: { ...DEFAULT_TOOL_POLICY, ...agent.toolPolicy },
      memoryPolicy: { ...DEFAULT_MEMORY_POLICY, ...agent.memoryPolicy },
      budget: { ...DEFAULT_RUN_BUDGET, ...agent.budget },
      enabledSkillIds: enabledSkills,
    };
  }

  private agentForChannel(workspaceId: string, channelType: string, accountId: string): string | undefined {
    const wanted: ChannelBinding[] = [{ channelType, accountId }, { channelType, accountId: 'default' }];
    const match = this.agents.list(workspaceId).find(agent =>
      agent.bindings.some(b => wanted.some(w => w.channelType === b.channelType && w.accountId === b.accountId)));
    return match?.id ?? this.agents.getDefault(workspaceId)?.id;
  }

  private async buildTurn(run: RunRecord, snapshot: AgentSnapshot): Promise<BuiltTurn> {
    const lastUser = [...this.conversations.listUpTo(run.workspaceId, run.conversationId)].reverse().find(m => m.role === 'user');
    const route = await this.providers.resolveRoute(run.workspaceId, {
      accountId: snapshot.providerId ?? undefined,
      modelOverride: snapshot.model ?? undefined,
    });
    const skills = this.skills.enabledInstructions(run.workspaceId)
      .filter(s => snapshot.enabledSkillIds.includes(s.id));
    const planned = this.planner.build({
      workspaceId: run.workspaceId,
      conversationId: run.conversationId,
      snapshot,
      skills,
      memoryQuery: lastUser?.content,
    });
    this.runRepo.savePlan(run, planned.plan);
    const tools = snapshot.toolPolicy.allowedTools
      .map(name => this.tools.has(name) ? this.tools.get(name) : undefined)
      .filter((t): t is ToolDefinition => Boolean(t))
      .map(toolSchema);
    return { route, systemPrompt: planned.systemPrompt, messages: planned.messages, tools };
  }

  private async executeApprovedTool(run: RunRecord, name: string, version: number, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.resolve(name, version);
    const snapshot = run.agentSnapshot ?? this.snapshot(this.agents.require(run.workspaceId, run.agentId));
    const validated = tool.validate(args);
    return tool.execute(validated, {
      workspaceId: run.workspaceId,
      runId: run.id,
      artifacts: this.artifacts,
      maxArtifactReadBytes: snapshot.toolPolicy.maxArtifactReadBytes,
      maxListEntries: snapshot.toolPolicy.maxListEntries,
      now: new Date(),
    });
  }

  private originalArgs(runId: string, toolCallId: string): Record<string, unknown> {
    const message = [...this.conversations.listUpTo(this.runs.requireRun(runId).workspaceId, this.runs.requireRun(runId).conversationId)]
      .reverse().find(m => (m.metadata?.toolCalls as Array<{ id: string }> | undefined)?.some(c => c.id === toolCallId));
    const call = (message?.metadata?.toolCalls as Array<{ id: string; arguments: Record<string, unknown> }> | undefined)?.find(c => c.id === toolCallId);
    return call?.arguments ?? {};
  }

  private toolName(runId: string, toolCallId: string): string {
    return this.runs.getToolInvocation(runId, toolCallId)?.toolName ?? toolCallId;
  }

  private lastAssistantText(workspaceId: string, conversationId: string): string {
    const messages = this.conversations.listUpTo(workspaceId, conversationId, undefined, 5);
    return [...messages].reverse().find(m => m.role === 'assistant' && m.content)?.content ?? '';
  }

  /** Real summarization over an exact source range; failures never truncate raw history. */
  private async afterRun(run: RunRecord): Promise<void> {
    const snapshot = run.agentSnapshot;
    if (!snapshot?.memoryPolicy.enabled) return;
    const messages = this.conversations.listUpTo(run.workspaceId, run.conversationId);
    const tracked = this.memory.latestSummary(run.workspaceId, run.conversationId);
    const startSeq = tracked ? tracked.cursorEndSeq + 1 : 1;
    const untracked = messages.filter(m => m.seq >= startSeq && (m.role === 'user' || m.role === 'assistant') && m.content);
    const tokens = untracked.reduce((n, m) => n + estimateTokens(m.content), 0);
    if (tokens < snapshot.memoryPolicy.summaryThresholdTokens || untracked.length < 6) return;
    try {
      const route = await this.providers.resolveRoute(run.workspaceId, {
        accountId: snapshot.providerId ?? undefined,
        modelOverride: snapshot.model ?? undefined,
      });
      const transcript = untracked.map(m => `${m.role}: ${m.content}`).join('\n').slice(-24_000);
      let content = '';
      for await (const event of this.model.stream({
        systemPrompt: 'Summarize the conversation faithfully and concisely. Preserve facts, decisions, names and open questions. Output the summary only.',
        messages: [{ role: 'user', content: transcript }],
        model: { provider: route.vendorId, id: route.model, apiKey: route.apiKey, baseUrl: route.baseUrl, api: route.api, headers: route.headers },
      }, { aborted: false })) {
        if (event.type === 'complete') content = event.message;
        if (event.type === 'error') return;
      }
      if (content.trim()) {
        this.memory.addSummary(run.workspaceId, {
          conversationId: run.conversationId,
          cursorStartSeq: startSeq,
          cursorEndSeq: untracked[untracked.length - 1].seq,
          tokenEstimate: estimateTokens(content),
          content: content.trim(),
        });
      }
    } catch {
      // A failed summary must not destroy the run; raw history remains the source of truth.
    }
  }

  close(): void {
    this.scheduler.stop();
    this.db.close();
  }
}

function isTerminalView(status: RunRecord['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function toolSchema(tool: ToolDefinition) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of tool.params) {
    properties[param.name] = {
      type: param.type === 'number' ? 'number' : param.type === 'boolean' ? 'boolean' : 'string',
      description: param.description,
      maxLength: param.maxLength,
    };
    if (param.required) required.push(param.name);
  }
  return { name: tool.name, description: tool.description, parameters: { type: 'object', properties, required, additionalProperties: false } };
}
