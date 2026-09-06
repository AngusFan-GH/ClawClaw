import { create } from 'zustand';
import { invokeIpc } from '@/lib/api-client';
import type { AgentSummary, AgentsSnapshot, LocalAgentSnapshot } from '@/types/agent';
import type { ChannelType } from '@/types/channel';

type CoreAgent = { id: string; name: string; model?: string; isDefault: boolean; channelBindings: Array<{ channelType: string; accountId: string; isDefaultAccount: boolean }> };
interface AgentsState { agents: AgentSummary[]; defaultAgentId: string; mainKey: string; scope: string | null; configuredChannelTypes: string[]; channelOwners: Record<string, string>; channelAccountOwners: Record<string, string>; loading: boolean; error: string | null; fetchAgents: (options?: { silent?: boolean }) => Promise<void>; createAgent: (name: string) => Promise<void>; updateAgent: (id: string, updates: { name?: string; model?: string | null }) => Promise<void>; deleteAgent: (id: string) => Promise<void>; assignChannel: (id: string, type: ChannelType, accountId?: string) => Promise<void>; removeChannel: (id: string, type: ChannelType, accountId?: string) => Promise<void>; }
type AgentsSnapshotState = Pick<AgentsState, 'agents' | 'defaultAgentId' | 'mainKey' | 'scope' | 'configuredChannelTypes' | 'channelOwners' | 'channelAccountOwners'>;
let applied: AgentsSnapshotState = { agents: [], defaultAgentId: 'main', mainKey: 'main', scope: null, configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {} };

function snapshot(rows: CoreAgent[]): AgentsSnapshotState {
  const defaultAgentId = rows.find(x => x.isDefault)?.id || 'main'; const channelOwners: Record<string, string> = {}; const channelAccountOwners: Record<string, string> = {};
  const agents = rows.map((agent): AgentSummary => {
    for (const binding of agent.channelBindings) { channelOwners[binding.channelType] ||= agent.id; channelAccountOwners[`${binding.channelType}:${binding.accountId}`] = agent.id; }
    return { gateway: { id: agent.id, name: agent.name, isDefault: agent.isDefault }, local: { workspace: 'default', agentDir: '', modelDisplay: agent.model || 'Not configured', modelRef: agent.model, inheritedModel: !agent.model, boundChannels: [...new Set(agent.channelBindings.map(x => x.channelType))], boundChannelAccounts: agent.channelBindings } };
  });
  return { agents, defaultAgentId, mainKey: defaultAgentId, scope: 'local', configuredChannelTypes: Object.keys(channelOwners), channelOwners, channelAccountOwners };
}
export function getAppliedAgentsSnapshotState(): AgentsSnapshotState { return applied; }
async function reload(set: (data: Partial<AgentsState>) => void) { const state = snapshot(await invokeIpc<CoreAgent[]>('agent:list')); applied = state; set({ ...state, loading: false, error: null }); }
export const useAgentsStore = create<AgentsState>((set) => ({
  ...applied, loading: false, error: null,
  fetchAgents: async options => { if (!options?.silent) set({ loading: true }); try { await reload(set); } catch (error) { set({ loading: false, error: String(error) }); } },
  createAgent: async name => { try { await invokeIpc('agent:create', name); await reload(set); } catch (error) { set({ error: String(error) }); throw error; } },
  updateAgent: async (id, updates) => { try { await invokeIpc('agent:update', id, updates); await reload(set); } catch (error) { set({ error: String(error) }); throw error; } },
  deleteAgent: async id => { try { await invokeIpc('agent:delete', id); await reload(set); } catch (error) { set({ error: String(error) }); throw error; } },
  assignChannel: async (id, type, accountId) => { try { await invokeIpc('agent:bindChannel', id, type, accountId); await reload(set); } catch (error) { set({ error: String(error) }); throw error; } },
  removeChannel: async (id, type, accountId) => { try { await invokeIpc('agent:unbindChannel', id, type, accountId); await reload(set); } catch (error) { set({ error: String(error) }); throw error; } },
}));
export type { LocalAgentSnapshot, AgentsSnapshot };
