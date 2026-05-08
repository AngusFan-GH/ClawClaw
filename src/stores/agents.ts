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
import { useRuntimeApplyStore } from './runtime-apply';

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
  fetchAgents: (options?: { silent?: boolean }) => Promise<void>;
  createAgent: (name: string) => Promise<void>;
  updateAgent: (agentId: string, updates: { name?: string; model?: string | null }) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  assignChannel: (agentId: string, channelType: ChannelType, accountId?: string) => Promise<void>;
  removeChannel: (agentId: string, channelType: ChannelType, accountId?: string) => Promise<void>;
}

type AgentsSnapshotState = Pick<
  AgentsState,
  'agents' | 'defaultAgentId' | 'mainKey' | 'scope' | 'configuredChannelTypes' | 'channelOwners' | 'channelAccountOwners'
>;

const AGENTS_LIST_RPC_TIMEOUT_MS = 3000;
const EMPTY_AGENTS_SNAPSHOT_STATE: AgentsSnapshotState = {
  agents: [],
  defaultAgentId: 'main',
  mainKey: 'main',
  scope: null,
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
};
let appliedAgentsSnapshotState: AgentsSnapshotState = EMPTY_AGENTS_SNAPSHOT_STATE;

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
    modelRef: undefined,
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
        modelRef: localAgent.modelRef,
        inheritedModel: localAgent.inheritedModel,
        boundChannels: localAgent.channelTypes,
        boundChannelAccounts: localAgent.channelBindings,
      }
    : buildDefaultLocalExtras();
}

function mergeAgentSnapshots(
  gatewaySnapshot: GatewayAgentsListResult | undefined,
  localSnapshot: AgentsSnapshot | undefined,
): AgentsSnapshotState {
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

function hasPendingAgentChanges(): boolean {
  const plan = useRuntimeApplyStore.getState().plan;
  return Array.isArray(plan.pending) && plan.pending.some((entry) => entry.domain === 'agents');
}

function rememberAppliedAgentsSnapshot(snapshot: AgentsSnapshotState): void {
  appliedAgentsSnapshotState = {
    ...snapshot,
    agents: [...snapshot.agents],
    configuredChannelTypes: [...snapshot.configuredChannelTypes],
    channelOwners: { ...snapshot.channelOwners },
    channelAccountOwners: { ...snapshot.channelAccountOwners },
  };
}

export function getAppliedAgentsSnapshotState(): AgentsSnapshotState {
  if (!hasPendingAgentChanges()) {
    const state = useAgentsStore.getState();
    return {
      agents: state.agents,
      defaultAgentId: state.defaultAgentId,
      mainKey: state.mainKey,
      scope: state.scope,
      configuredChannelTypes: state.configuredChannelTypes,
      channelOwners: state.channelOwners,
      channelAccountOwners: state.channelAccountOwners,
    };
  }
  return appliedAgentsSnapshotState;
}

async function refreshAgentsAfterMutation(): Promise<void> {
  await useRuntimeApplyStore.getState().refreshPlan();
  await useAgentsStore.getState().fetchAgents();
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

  fetchAgents: async (options) => {
    const silent = options?.silent === true;
    set((state) => ({
      loading: silent ? state.loading : true,
      error: null,
    }));
    let localSnapshot: (AgentsSnapshot & { success?: boolean }) | undefined;
    try {
      localSnapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents');
      const mergedLocal = mergeAgentSnapshots(undefined, localSnapshot);
      if (!hasPendingAgentChanges()) {
        rememberAppliedAgentsSnapshot(mergedLocal);
      }
      set({
        ...mergedLocal,
        loading: false,
        error: null,
      });
    } catch (error) {
      set((state) => ({
        loading: false,
        error: String(error),
        agents: state.agents,
        defaultAgentId: state.defaultAgentId,
        mainKey: state.mainKey,
        scope: state.scope,
        configuredChannelTypes: state.configuredChannelTypes,
        channelOwners: state.channelOwners,
        channelAccountOwners: state.channelAccountOwners,
      }));
      return;
    }

    try {
      const gatewayState = useGatewayStore.getState();
      const shouldIncludeRuntime =
        gatewayState.status.state === 'running' &&
        !hasPendingAgentChanges() &&
        gatewayState.lifecycle.state !== 'scheduled' &&
        gatewayState.lifecycle.state !== 'applying';

      if (!shouldIncludeRuntime) {
        return;
      }

      const gatewaySnapshot = await gatewayState.rpc<GatewayAgentsListResult>(
        'agents.list',
        {},
        AGENTS_LIST_RPC_TIMEOUT_MS,
      );
      const merged = mergeAgentSnapshots(gatewaySnapshot, localSnapshot);
      rememberAppliedAgentsSnapshot(merged);
      set({
        ...merged,
        loading: false,
      });
    } catch {
      // Local snapshot is already rendered; ignore runtime enrichment failures.
    }
  },

  createAgent: async (name: string) => {
    set({ error: null });
    try {
      await hostApiFetch('/api/agents', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await refreshAgentsAfterMutation();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgent: async (agentId: string, updates: { name?: string; model?: string | null }) => {
    set({ error: null });
    try {
      await hostApiFetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      await refreshAgentsAfterMutation();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteAgent: async (agentId: string) => {
    set({ error: null });
    try {
      await hostApiFetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
      await refreshAgentsAfterMutation();
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
      await refreshAgentsAfterMutation();
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
      await refreshAgentsAfterMutation();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
}));
