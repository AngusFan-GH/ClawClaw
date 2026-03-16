import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { ChannelType } from '@/types/channel';
import type { AgentSummary, AgentsSnapshot } from '@/types/agent';
import { useGatewayStore } from './gateway';

type GatewayAgentIdentity = {
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
};

type GatewayAgentRow = {
  id: string;
  name?: string;
  identity?: GatewayAgentIdentity;
};

type GatewayAgentsListResult = {
  defaultId: string;
  mainKey?: string;
  scope?: string;
  agents: GatewayAgentRow[];
};

interface AgentsState {
  agents: AgentSummary[];
  defaultAgentId: string;
  mainKey: string;
  scope: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  createAgent: (name: string) => Promise<void>;
  updateAgent: (agentId: string, name: string) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  assignChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  removeChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  clearError: () => void;
}

function humanizeAgentId(agentId: string): string {
  if (agentId === 'main') return 'Main';
  return agentId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function buildDefaultSummary(agentId: string, defaultAgentId: string): AgentSummary {
  return {
    id: agentId,
    name: humanizeAgentId(agentId),
    isDefault: agentId === defaultAgentId,
    modelDisplay: 'Not configured',
    inheritedModel: false,
    workspace: '',
    agentDir: '',
    channelTypes: [],
  };
}

function mergeAgentSnapshots(
  gatewaySnapshot: GatewayAgentsListResult | undefined,
  localSnapshot: AgentsSnapshot | undefined,
): AgentsSnapshot {
  const defaultAgentId = gatewaySnapshot?.defaultId ?? localSnapshot?.defaultAgentId ?? 'main';
  const localById = new Map((localSnapshot?.agents ?? []).map((agent) => [agent.id, agent]));
  const gatewayAgents = Array.isArray(gatewaySnapshot?.agents) ? gatewaySnapshot!.agents : [];

  const mergedAgents: AgentSummary[] = gatewayAgents.map((gatewayAgent) => {
    const local = localById.get(gatewayAgent.id);
    const identityName = gatewayAgent.identity?.name?.trim();
    const configuredName = gatewayAgent.name?.trim();
    return {
      ...(local ?? buildDefaultSummary(gatewayAgent.id, defaultAgentId)),
      id: gatewayAgent.id,
      name: configuredName || identityName || local?.name || humanizeAgentId(gatewayAgent.id),
      identity: gatewayAgent.identity,
      isDefault: gatewayAgent.id === defaultAgentId,
    };
  });

  for (const localAgent of localSnapshot?.agents ?? []) {
    if (mergedAgents.some((agent) => agent.id === localAgent.id)) continue;
    mergedAgents.push({
      ...localAgent,
      isDefault: localAgent.id === defaultAgentId,
    });
  }

  return {
    agents: mergedAgents,
    defaultAgentId,
    mainKey: gatewaySnapshot?.mainKey ?? localSnapshot?.mainKey ?? 'main',
    scope: gatewaySnapshot?.scope ?? localSnapshot?.scope,
    configuredChannelTypes: Array.isArray(localSnapshot?.configuredChannelTypes)
      ? localSnapshot!.configuredChannelTypes
      : [],
    channelOwners:
      localSnapshot?.channelOwners && typeof localSnapshot.channelOwners === 'object'
        ? localSnapshot.channelOwners
        : {},
  };
}

function applySnapshot(snapshot: AgentsSnapshot | undefined) {
  return snapshot ? {
    agents: Array.isArray(snapshot.agents) ? snapshot.agents : [],
    defaultAgentId: snapshot.defaultAgentId ?? 'main',
    mainKey: snapshot.mainKey ?? 'main',
    scope: typeof snapshot.scope === 'string' ? snapshot.scope : null,
    configuredChannelTypes: Array.isArray(snapshot.configuredChannelTypes)
      ? snapshot.configuredChannelTypes
      : [],
    channelOwners:
      snapshot.channelOwners && typeof snapshot.channelOwners === 'object'
        ? snapshot.channelOwners
        : {},
  } : {};
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  defaultAgentId: 'main',
  mainKey: 'main',
  scope: null,
  configuredChannelTypes: [],
  channelOwners: {},
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const [gatewayResult, localResult] = await Promise.allSettled([
        useGatewayStore.getState().rpc<GatewayAgentsListResult>('agents.list', {}),
        hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents'),
      ]);
      const gatewaySnapshot = gatewayResult.status === 'fulfilled' ? gatewayResult.value : undefined;
      const localSnapshot = localResult.status === 'fulfilled' ? localResult.value : undefined;
      const snapshot = mergeAgentSnapshots(gatewaySnapshot, localSnapshot);
      set({
        ...applySnapshot(snapshot),
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  createAgent: async (name: string) => {
    set({ error: null });
    try {
      await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await useAgentsStore.getState().fetchAgents();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgent: async (agentId: string, name: string) => {
    set({ error: null });
    try {
      await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ name }),
        }
      );
      await useAgentsStore.getState().fetchAgents();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteAgent: async (agentId: string) => {
    set({ error: null });
    try {
      await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}`,
        { method: 'DELETE' }
      );
      await useAgentsStore.getState().fetchAgents();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  assignChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}`,
        { method: 'PUT' }
      );
      await useAgentsStore.getState().fetchAgents();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  removeChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      await hostApiFetch<AgentsSnapshot & { success?: boolean }>(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}`,
        { method: 'DELETE' }
      );
      await useAgentsStore.getState().fetchAgents();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
