/**
 * Workspace-scoped agent profiles.
 *
 * A run stores an immutable snapshot of its agent (see contracts.AgentSnapshot);
 * editing an agent never affects an in-flight or historical run. Deleting an
 * agent removes bindings but never deletes runs/conversations.
 */
import type { CoreDatabase } from './db/database';
import { DEFAULT_MEMORY_POLICY, DEFAULT_RUN_BUDGET, DEFAULT_TOOL_POLICY, type MemoryPolicy, type RunBudget, type ToolPolicy } from './contracts';
import { fail } from './errors';
import { isoNow, newId } from './util';

export interface ChannelBinding {
  channelType: string;
  accountId: string;
}

export interface AgentInput {
  name?: string;
  systemPrompt?: string;
  providerId?: string | null;
  model?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
  toolPolicy?: Partial<ToolPolicy>;
  memoryPolicy?: Partial<MemoryPolicy>;
  budget?: Partial<RunBudget>;
  bindings?: ChannelBinding[];
}

interface AgentRow {
  id: string;
  workspace_id: string;
  name: string;
  system_prompt: string;
  provider_id: string | null;
  model: string | null;
  tools_policy_json: string;
  memory_policy_json: string;
  budget_json: string;
  bindings_json: string;
  enabled: number;
  is_default: number;
  config_json: string;
  created_at: string;
  updated_at: string;
}

export interface AgentView {
  id: string;
  workspaceId: string;
  name: string;
  systemPrompt: string;
  providerId?: string | null;
  model?: string | null;
  toolPolicy: ToolPolicy;
  memoryPolicy: MemoryPolicy;
  budget: RunBudget;
  bindings: ChannelBinding[];
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const slug = (name: string): string =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || newId();

export class AgentStore {
  constructor(private readonly ctx: CoreDatabase) {}

  private get db() {
    return this.ctx.db;
  }

  list(workspaceId = 'default'): AgentView[] {
    return (this.db.prepare('SELECT * FROM core_agent WHERE workspace_id=? ORDER BY is_default DESC, updated_at DESC').all(workspaceId) as unknown as AgentRow[])
      .map(r => this.toView(r));
  }

  getRow(workspaceId: string, id: string): AgentRow | undefined {
    return this.db.prepare('SELECT * FROM core_agent WHERE workspace_id=? AND id=?').get(workspaceId, id) as unknown as AgentRow | undefined;
  }

  get(workspaceId: string, id: string): AgentView | undefined {
    const row = this.getRow(workspaceId, id);
    return row ? this.toView(row) : undefined;
  }

  require(workspaceId: string, id: string): AgentView {
    return this.get(workspaceId, id) ?? fail('AGENT_NOT_FOUND', 'The agent does not exist');
  }

  getDefault(workspaceId = 'default'): AgentView | undefined {
    const row = this.db.prepare('SELECT * FROM core_agent WHERE workspace_id=? AND is_default=1').get(workspaceId) as unknown as AgentRow | undefined;
    return row ? this.toView(row) : undefined;
  }

  resolveAgentId(workspaceId: string, agentId?: string | null): string {
    if (agentId) {
      const row = this.getRow(workspaceId, agentId);
      if (row) return row.id;
    }
    const def = this.getDefault(workspaceId) ?? fail('AGENT_NOT_FOUND', 'No agent is configured');
    return def.id;
  }

  create(workspaceId: string, name: string): AgentView {
    const trimmed = name?.trim();
    if (!trimmed) fail('INVALID_ARGUMENT', 'Agent name is required');
    let id = slug(trimmed);
    if (this.getRow(workspaceId, id)) id = `${id}-${newId().slice(0, 8)}`;
    const ts = isoNow();
    const becomesDefault = !this.getDefault(workspaceId);
    this.ctx.transaction(() => {
      if (becomesDefault) this.clearDefault(workspaceId);
      this.db.prepare(`INSERT INTO core_agent
        (id,workspace_id,name,system_prompt,provider_id,model,tools_policy_json,memory_policy_json,budget_json,bindings_json,enabled,is_default,config_json,created_at,updated_at)
        VALUES (?,?,?,'',NULL,NULL,?,?,?,'[]',1,?,'{}',?,?)`)
        .run(id, workspaceId, trimmed, JSON.stringify(DEFAULT_TOOL_POLICY), JSON.stringify(DEFAULT_MEMORY_POLICY),
          JSON.stringify(DEFAULT_RUN_BUDGET), becomesDefault ? 1 : 0, ts, ts);
    });
    return this.require(workspaceId, id);
  }

  update(workspaceId: string, id: string, patch: AgentInput): AgentView {
    const current = this.requireRow(workspaceId, id);
    const name = patch.name !== undefined ? patch.name.trim() : current.name;
    if (!name) fail('INVALID_ARGUMENT', 'Agent name is required');
    const toolPolicy = { ...this.json<ToolPolicy>(current.tools_policy_json, DEFAULT_TOOL_POLICY), ...(patch.toolPolicy ?? {}) };
    const memoryPolicy = { ...this.json<MemoryPolicy>(current.memory_policy_json, DEFAULT_MEMORY_POLICY), ...(patch.memoryPolicy ?? {}) };
    const budget = { ...this.json<RunBudget>(current.budget_json, DEFAULT_RUN_BUDGET), ...(patch.budget ?? {}) };
    const bindings = patch.bindings !== undefined ? sanitizeBindings(patch.bindings) : (JSON.parse(current.bindings_json) as unknown as ChannelBinding[]);
    const ts = isoNow();
    this.ctx.transaction(() => {
      if (patch.isDefault === true && current.is_default === 0) this.clearDefault(workspaceId);
      this.db.prepare(`UPDATE core_agent SET
         name=?, system_prompt=?, provider_id=?, model=?, tools_policy_json=?, memory_policy_json=?, budget_json=?,
         bindings_json=?, enabled=COALESCE(?, enabled), is_default=?, updated_at=?
         WHERE workspace_id=? AND id=?`)
        .run(
          name,
          patch.systemPrompt !== undefined ? patch.systemPrompt : current.system_prompt,
          patch.providerId === undefined ? current.provider_id : patch.providerId,
          patch.model === undefined ? current.model : patch.model,
          JSON.stringify(toolPolicy), JSON.stringify(memoryPolicy), JSON.stringify(budget),
          JSON.stringify(bindings),
          patch.enabled === undefined ? null : patch.enabled ? 1 : 0,
          patch.isDefault === undefined ? current.is_default : patch.isDefault ? 1 : 0,
          ts, workspaceId, id,
        );
    });
    return this.require(workspaceId, id);
  }

  setDefault(workspaceId: string, id: string): AgentView {
    this.requireRow(workspaceId, id);
    this.ctx.transaction(() => {
      this.clearDefault(workspaceId);
      this.db.prepare('UPDATE core_agent SET is_default=1, updated_at=? WHERE workspace_id=? AND id=?').run(isoNow(), workspaceId, id);
    });
    return this.require(workspaceId, id);
  }

  bind(workspaceId: string, id: string, channelType: string, accountId = 'default'): AgentView {
    const current = this.requireRow(workspaceId, id);
    const bindings = JSON.parse(current.bindings_json) as unknown as ChannelBinding[];
    const next = [...bindings.filter(b => !(b.channelType === channelType && b.accountId === accountId)), { channelType, accountId }];
    return this.update(workspaceId, id, { bindings: next });
  }

  unbind(workspaceId: string, id: string, channelType: string, accountId = 'default'): AgentView {
    const current = this.requireRow(workspaceId, id);
    const bindings = (JSON.parse(current.bindings_json) as unknown as ChannelBinding[])
      .filter(b => !(b.channelType === channelType && b.accountId === accountId));
    return this.update(workspaceId, id, { bindings });
  }

  /** Remove bindings pointing at a deleted channel account. */
  unbindAccount(workspaceId: string, accountId: string): void {
    for (const agent of this.list(workspaceId)) {
      if (agent.bindings.some(b => b.accountId === accountId)) {
        this.update(workspaceId, agent.id, { bindings: agent.bindings.filter(b => b.accountId !== accountId) });
      }
    }
  }

  delete(workspaceId: string, id: string): void {
    const row = this.requireRow(workspaceId, id);
    if (row.is_default === 1) fail('AGENT_DEFAULT_PROTECTED', 'Cannot delete the default agent; designate another default first');
    // Historical runs/conversations are intentionally retained (by agent id).
    this.db.prepare('DELETE FROM core_agent WHERE workspace_id=? AND id=?').run(workspaceId, id);
  }

  private requireRow(workspaceId: string, id: string): AgentRow {
    return this.getRow(workspaceId, id) ?? fail('AGENT_NOT_FOUND', 'The agent does not exist');
  }

  private clearDefault(workspaceId: string): void {
    this.db.prepare('UPDATE core_agent SET is_default=0 WHERE workspace_id=?').run(workspaceId);
  }

  private json<T>(raw: string, fallback: T): T {
    try {
      return { ...fallback, ...(JSON.parse(raw) as unknown as object) } as T;
    } catch {
      return fallback;
    }
  }

  toView(r: AgentRow): AgentView {
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      systemPrompt: r.system_prompt,
      providerId: r.provider_id,
      model: r.model,
      toolPolicy: this.json(r.tools_policy_json, DEFAULT_TOOL_POLICY),
      memoryPolicy: this.json(r.memory_policy_json, DEFAULT_MEMORY_POLICY),
      budget: this.json(r.budget_json, DEFAULT_RUN_BUDGET),
      bindings: safeBindings(r.bindings_json),
      enabled: r.enabled === 1,
      isDefault: r.is_default === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}

function sanitizeBindings(bindings: ChannelBinding[]): ChannelBinding[] {
  return bindings
    .filter(b => b && typeof b.channelType === 'string' && typeof b.accountId === 'string')
    .map(b => ({ channelType: b.channelType.slice(0, 64), accountId: b.accountId.slice(0, 128) }));
}

function safeBindings(raw: string): ChannelBinding[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sanitizeBindings(parsed) : [];
  } catch {
    return [];
  }
}
