import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type {
  AgentSummary,
  AgentsSnapshot,
  GatewayAgentSummary,
  LocalAgentExtras,
  LocalAgentSnapshot,
} from '@/types/agent';
import type { ChannelType } from '@/types/channel';
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
  channelAccountOwners: Record<string, string>;
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  createAgent: (name: string) => Promise<void>;
  updateAgent: (agentId: string, name: string) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  assignChannel: (agentId: string, channelType: ChannelType, accountId?: string) => Promise<void>;
  removeChannel: (agentId: string, channelType: ChannelType, accountId?: string) => Promise<void>;
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

function buildDefaultLocalExtras(): LocalAgentExtras {
  return {
    workspace: '',
    agentDir: '',
    modelDisplay: 'Not configured',
    inheritedModel: false,
    boundChannels: [],
    boundChannelAccounts: [],
  };
}

function buildGatewaySummary(
  gatewayAgent: GatewayAgentRow,
  defaultAgentId: string,
  fallbackName?: string,
): GatewayAgentSummary {
  const identityName = gatewayAgent.identity?.name?.trim();
  const configuredName = gatewayAgent.name?.trim();
  return {
    id: gatewayAgent.id,
    name: configuredName || identityName || fallbackName || humanizeAgentId(gatewayAgent.id),
    identity: gatewayAgent.identity,
    isDefault: gatewayAgent.id === defaultAgentId,
  };
}

function buildLocalExtras(localAgent?: LocalAgentSnapshot): LocalAgentExtras {
  return localAgent
    ? {
        workspace: localAgent.workspace,
        agentDir: localAgent.agentDir,
        modelDisplay: localAgent.modelDisplay,
        inheritedModel: localAgent.inheritedModel,
        boundChannels: localAgent.channelTypes,
        boundChannelAccounts: localAgent.channelBindings,
      }
    : buildDefaultLocalExtras();
}

function mergeAgentSnapshots(
  gatewaySnapshot: GatewayAgentsListResult | undefined,
  localSnapshot: AgentsSnapshot | undefined,
): {
  agents: AgentSummary[];
  defaultAgentId: string;
  mainKey: string;
  scope: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
} {
  const defaultAgentId = gatewaySnapshot?.defaultId ?? localSnapshot?.defaultAgentId ?? 'main';
  const localById = new Map((localSnapshot?.agents ?? []).map((agent) => [agent.id, agent]));
  const mergedAgents: AgentSummary[] = [];
  const seen = new Set<string>();

  for (const gatewayAgent of gatewaySnapshot?.agents ?? []) {
    const localAgent = localById.get(gatewayAgent.id);
    mergedAgents.push({
      gateway: buildGatewaySummary(gatewayAgent, defaultAgentId, localAgent?.name),
      local: buildLocalExtras(localAgent),
    });
    seen.add(gatewayAgent.id);
  }

  for (const localAgent of localSnapshot?.agents ?? []) {
    if (seen.has(localAgent.id)) continue;
    mergedAgents.push({
      gateway: {
        id: localAgent.id,
        name: localAgent.name || humanizeAgentId(localAgent.id),
        isDefault: localAgent.id === defaultAgentId,
      },
      local: buildLocalExtras(localAgent),
    });
  }

  return {
    agents: mergedAgents,
    defaultAgentId,
    mainKey: gatewaySnapshot?.mainKey ?? localSnapshot?.mainKey ?? 'main',
    scope: gatewaySnapshot?.scope ?? localSnapshot?.scope ?? null,
    configuredChannelTypes: Array.isArray(localSnapshot?.configuredChannelTypes)
      ? localSnapshot!.configuredChannelTypes
      : [],
    channelOwners:
      localSnapshot?.channelOwners && typeof localSnapshot.channelOwners === 'object'
        ? localSnapshot.channelOwners
        : {},
    channelAccountOwners:
      localSnapshot?.channelAccountOwners && typeof localSnapshot.channelAccountOwners === 'object'
        ? localSnapshot.channelAccountOwners
        : {},
  };
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  defaultAgentId: 'main',
  mainKey: 'main',
  scope: null,
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const [gatewayResult, localResult] = await Promise.allSettled([
        useGatewayStore.getState().rpc<GatewayAgentsListResult>('agents.list', {}),
        hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents'),
      ]);
      const merged = mergeAgentSnapshots(
        gatewayResult.status === 'fulfilled' ? gatewayResult.value : undefined,
        localResult.status === 'fulfilled' ? localResult.value : undefined,
      );
      set({
        ...merged,
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  createAgent: async (name: string) => {
    set({ error: null });
    try {
      await hostApiFetch('/api/agents', {
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
      await hostApiFetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      await useAgentsStore.getState().fetchAgents();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteAgent: async (agentId: string) => {
    set({ error: null });
    try {
      await hostApiFetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
      await useAgentsStore.getState().fetchAgents();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  assignChannel: async (agentId: string, channelType: ChannelType, accountId?: string) => {
    set({ error: null });
    try {
      const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
      await hostApiFetch(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}${query}`,
        { method: 'PUT' },
      );
      await useAgentsStore.getState().fetchAgents();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  removeChannel: async (agentId: string, channelType: ChannelType, accountId?: string) => {
    set({ error: null });
    try {
      const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
      await hostApiFetch(
        `/api/agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelType)}${query}`,
        { method: 'DELETE' },
      );
      await useAgentsStore.getState().fetchAgents();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
