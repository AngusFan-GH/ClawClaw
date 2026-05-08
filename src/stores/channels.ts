import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { Channel, ChannelGroup, ChannelType } from '../types/channel';
import { CHANNEL_NAMES } from '../types/channel';
import { useRuntimeApplyStore } from './runtime-apply';

interface AddChannelParams {
  type: ChannelType;
  name: string;
}

interface ChannelsState {
  channelGroups: ChannelGroup[];
  channels: Channel[];
  loading: boolean;
  error: string | null;
  fetchChannels: (probe?: boolean, options?: { includeRuntime?: boolean }) => Promise<void>;
  addChannel: (params: AddChannelParams) => Promise<Channel>;
  deleteChannel: (channelId: string, accountId?: string) => Promise<void>;
}

function normalizeChannelId(channelId: string): string {
  return channelId === 'openclaw-weixin' ? 'wechat' : channelId;
}

function resolveChannelTypeFromId(channelId: string): ChannelType | undefined {
  const normalizedId = normalizeChannelId(channelId);
  const channelTypes = Object.keys(CHANNEL_NAMES) as ChannelType[];
  return channelTypes.find(
    (type) =>
      normalizedId === type ||
      normalizedId.startsWith(`${type}-`) ||
      normalizedId.startsWith(`${type}:`),
  );
}

function flattenGroups(groups: ChannelGroup[]): Channel[] {
  return groups.flatMap((group) =>
    group.accounts.map((account) => ({
      id: account.id,
      type: account.type,
      name: account.name,
      status: account.status,
      configured: account.configured,
      runtimeLoaded: account.runtimeLoaded,
      runtimeStatus: account.runtimeStatus,
      accountId: account.accountId,
      lastActivity: account.lastActivity,
      error: account.error,
      metadata: {
        ...account.metadata,
        defaultAccountId: group.defaultAccountId,
        isDefaultAccount: account.isDefaultAccount,
      },
    })),
  );
}

function sortGroups(groups: ChannelGroup[]): ChannelGroup[] {
  return [...groups].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeGroups(groups: ChannelGroup[]): ChannelGroup[] {
  return groups.map((group) => ({
    ...group,
    name: group.name?.trim() || CHANNEL_NAMES[group.type] || group.type,
    accounts: group.accounts.map((account) => ({
      ...account,
      name: account.name?.trim() || CHANNEL_NAMES[group.type] || group.type,
    })),
  }));
}

const channelGroupsInFlight = new Map<string, Promise<ChannelGroup[]>>();

async function fetchChannelGroups(probe = false, options?: { includeRuntime?: boolean }): Promise<ChannelGroup[]> {
  const search = new URLSearchParams();
  if (probe) {
    search.set('probe', 'true');
  }
  if ((options?.includeRuntime ?? false) === false) {
    search.set('includeRuntime', 'false');
  }
  const query = search.toString();
  const path = query ? `/api/channels/accounts?${query}` : '/api/channels/accounts';
  const inFlightKey = path;
  const existing = channelGroupsInFlight.get(inFlightKey);
  if (existing) return existing;

  const request = hostApiFetch<{
    success: boolean;
    channels?: ChannelGroup[];
  }>(path).then((result) => (
    result.success && Array.isArray(result.channels) ? normalizeGroups(result.channels) : []
  )).finally(() => {
    channelGroupsInFlight.delete(inFlightKey);
  });
  channelGroupsInFlight.set(inFlightKey, request);
  return request;
}

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  channelGroups: [],
  channels: [],
  loading: false,
  error: null,

  fetchChannels: async (probe = false, options) => {
    const shouldShowLoading = get().channelGroups.length === 0;
    set((state) => ({
      loading: shouldShowLoading ? true : state.loading,
      error: null,
    }));
    try {
      const finalGroups = sortGroups(await fetchChannelGroups(probe, options));
      set({
        channelGroups: finalGroups,
        channels: flattenGroups(finalGroups),
        loading: false,
        error: null,
      });
    } catch (error) {
      set((state) => ({
        loading: false,
        error: String(error),
        channelGroups: state.channelGroups,
        channels: state.channels,
      }));
    }
  },

  addChannel: async (params) => {
    set({ error: null });
    try {
      await get().fetchChannels(false, { includeRuntime: false });
      const existing = get().channels.find((channel) => channel.type === params.type);
      if (existing) {
        return existing;
      }

      return {
        id: `${params.type}:default`,
        type: params.type,
        name: params.name,
        status: 'connecting',
        configured: true,
        runtimeLoaded: false,
        runtimeStatus: 'unknown',
        accountId: 'default',
        metadata: {
          isDefaultAccount: true,
        },
      };
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteChannel: async (channelId, accountId) => {
    set({ error: null });
    const channelType = resolveChannelTypeFromId(channelId);
    if (!channelType) {
      throw new Error(`Unknown channel type for id: ${channelId}`);
    }

    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    await hostApiFetch(`/api/channels/config/${encodeURIComponent(channelType)}${query}`, {
      method: 'DELETE',
    });

    await useRuntimeApplyStore.getState().refreshPlan();
    await get().fetchChannels(false, { includeRuntime: false });
  },
}));
