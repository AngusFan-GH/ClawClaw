import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app } from '../host/desktop';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
export type CoreAgent = { id: string; name: string; model?: string; isDefault: boolean; channelBindings: Array<{ channelType: string; accountId: string; isDefaultAccount: boolean }>; createdAt: string; updatedAt: string };

export class CoreAgentStore {
  private readonly db: InstanceType<typeof DatabaseSync>;
  constructor(file = join(app.getPath('userData'), 'clawcore.sqlite')) {
    this.db = new DatabaseSync(file); this.db.exec('CREATE TABLE IF NOT EXISTS core_agents (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;');
    if (!this.list().length) this.save({ id: 'main', name: 'Main', isDefault: true });
  }
  list(): CoreAgent[] { return (this.db.prepare('SELECT data_json FROM core_agents ORDER BY updated_at DESC').all() as { data_json: string }[]).map(row => JSON.parse(row.data_json)); }
  get(id: string): CoreAgent | undefined { const row = this.db.prepare('SELECT data_json FROM core_agents WHERE id=?').get(id) as { data_json: string } | undefined; return row && JSON.parse(row.data_json); }
  save(input: Partial<CoreAgent> & { id: string; name: string }): CoreAgent { const old = this.get(input.id); const now = new Date().toISOString(); const agent: CoreAgent = { id: input.id, name: input.name.trim() || input.id, model: input.model ?? old?.model, isDefault: input.isDefault ?? old?.isDefault ?? false, channelBindings: input.channelBindings ?? old?.channelBindings ?? [], createdAt: old?.createdAt || now, updatedAt: now }; if (agent.isDefault) for (const item of this.list()) if (item.id !== agent.id) this.save({ ...item, isDefault: false }); this.db.prepare('INSERT INTO core_agents VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at').run(agent.id, JSON.stringify(agent), agent.updatedAt); return agent; }
  create(name: string): CoreAgent { const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID(); if (this.get(id)) throw new Error('An agent with this name already exists'); return this.save({ id, name, isDefault: false }); }
  delete(id: string): void { const agent = this.get(id); if (!agent) return; if (agent.isDefault) throw new Error('The default agent cannot be deleted'); this.db.prepare('DELETE FROM core_agents WHERE id=?').run(id); }
  bind(agentId: string, channelType: string, accountId = 'default'): CoreAgent { const agent = this.get(agentId); if (!agent) throw new Error('Agent not found'); return this.save({ ...agent, channelBindings: [...agent.channelBindings.filter(x => !(x.channelType === channelType && x.accountId === accountId)), { channelType, accountId, isDefaultAccount: accountId === 'default' }] }); }
  unbind(agentId: string, channelType: string, accountId = 'default'): CoreAgent { const agent = this.get(agentId); if (!agent) throw new Error('Agent not found'); return this.save({ ...agent, channelBindings: agent.channelBindings.filter(x => !(x.channelType === channelType && x.accountId === accountId)) }); }
  close() { this.db.close(); }
}
