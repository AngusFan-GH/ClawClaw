/**
 * Channels State Store
 * Manages messaging channel state
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { useGatewayStore } from './gateway';
import type { Channel, ChannelType } from '../types/channel';
import { CHANNEL_NAMES } from '../types/channel';

interface AddChannelParams {
  type: ChannelType;
  name: string;
  token?: string;
}

function resolveChannelTypeFromId(channelId: string): ChannelType | undefined {
  const channelTypes = Object.keys(CHANNEL_NAMES) as ChannelType[];
  return channelTypes.find(
    (type) =>
      channelId === type ||
      channelId.startsWith(`${type}-`) ||
      channelId.startsWith(`${type}:`)
  );
}

interface ChannelsState {
  channels: Channel[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchChannels: (probe?: boolean) => Promise<void>;
  addChannel: (params: AddChannelParams) => Promise<Channel>;
  deleteChannel: (channelId: string, accountId?: string) => Promise<void>;
  setChannels: (channels: Channel[]) => void;
  updateChannel: (channelId: string, updates: Partial<Channel>) => void;
  clearError: () => void;
}

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  channels: [],
  loading: false,
  error: null,

  fetchChannels: async (probe = false) => {
    set({ loading: true, error: null });
    const gatewayStatus = useGatewayStore.getState().status;

    if (gatewayStatus.state !== 'running') {
      set({ loading: false });
      return;
    }

    try {
      const data = await useGatewayStore.getState().rpc<{
          channelOrder?: string[];
          channels?: Record<string, unknown>;
          channelAccounts?: Record<string, Array<{
            accountId?: string;
            configured?: boolean;
            connected?: boolean;
            running?: boolean;
            lastError?: string;
            name?: string;
            linked?: boolean;
            lastConnectedAt?: number | null;
            lastInboundAt?: number | null;
            lastOutboundAt?: number | null;
          }>>;
          channelDefaultAccountId?: Record<string, string>;
      }>('channels.status', { probe, timeoutMs: 8000 }, 9000);
      if (data) {
        const channels: Channel[] = [];

        // Parse the complex channels.status response into simple Channel objects
        const channelOrder = data.channelOrder || Object.keys(data.channels || {});
        for (const channelId of channelOrder) {
          const summary = (data.channels as Record<string, unknown> | undefined)?.[channelId] as Record<string, unknown> | undefined;
          const accounts = data.channelAccounts?.[channelId] || [];
          const accountActive = accounts.some((account) =>
            account.configured === true || account.running === true || account.connected === true
          );
          const configured =
            typeof summary?.configured === 'boolean'
              ? summary.configured
              : typeof (summary as { running?: boolean })?.running === 'boolean'
                ? true
                : false;
          const enabled =
            configured ||
            (typeof (summary as { connected?: boolean })?.connected === 'boolean' &&
              (summary as { connected?: boolean }).connected === true) ||
            accountActive;
          if (!enabled) continue;
          const defaultAccountId = data.channelDefaultAccountId?.[channelId];
          const now = Date.now();
          const RECENT_MS = 10 * 60 * 1000;
          const hasRecentActivity = (a: { lastInboundAt?: number | null; lastOutboundAt?: number | null; lastConnectedAt?: number | null }) =>
            (typeof a.lastInboundAt === 'number' && now - a.lastInboundAt < RECENT_MS) ||
            (typeof a.lastOutboundAt === 'number' && now - a.lastOutboundAt < RECENT_MS) ||
            (typeof a.lastConnectedAt === 'number' && now - a.lastConnectedAt < RECENT_MS);
          const summaryError =
            typeof (summary as { error?: string })?.error === 'string'
              ? (summary as { error?: string }).error
              : typeof (summary as { lastError?: string })?.lastError === 'string'
                ? (summary as { lastError?: string }).lastError
                : undefined;
          const mapAccountStatus = (account: {
            connected?: boolean;
            linked?: boolean;
            running?: boolean;
            lastError?: string;
            lastInboundAt?: number | null;
            lastOutboundAt?: number | null;
            lastConnectedAt?: number | null;
          }): Channel['status'] => {
            if (account.connected === true || account.linked === true || hasRecentActivity(account)) {
              return 'connected';
            }
            if (typeof account.lastError === 'string' && account.lastError) {
              return 'error';
            }
            if (account.running === true || hasRecentActivity(account)) {
              return 'connecting';
            }
            return 'disconnected';
          };

          if (accounts.length > 0) {
            for (const account of accounts) {
              const status = mapAccountStatus(account);
              channels.push({
                id: `${channelId}:${account.accountId || 'default'}`,
                type: channelId as ChannelType,
                name: account.name || CHANNEL_NAMES[channelId as ChannelType] || channelId,
                status,
                configured: account.configured ?? true,
                runtimeLoaded: true,
                runtimeStatus: status,
                accountId: account.accountId,
                error:
                  (typeof account.lastError === 'string' ? account.lastError : undefined) ||
                  (typeof summaryError === 'string' ? summaryError : undefined),
                metadata: {
                  defaultAccountId,
                  isDefaultAccount: account.accountId === defaultAccountId,
                },
              });
            }
            continue;
          }

          channels.push({
            id: `${channelId}:default`,
            type: channelId as ChannelType,
            name: CHANNEL_NAMES[channelId as ChannelType] || channelId,
            status: summaryError ? 'error' : 'disconnected',
            configured: true,
            runtimeLoaded: true,
            runtimeStatus: summaryError ? 'error' : 'unknown',
            accountId: defaultAccountId,
            error: typeof summaryError === 'string' ? summaryError : undefined,
            metadata: {
              defaultAccountId,
              isDefaultAccount: true,
            },
          });
        }

        set({ channels, loading: false });
      } else {
        set({ loading: false, error: 'No channel status snapshot returned' });
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  addChannel: async (params) => {
    set({ error: null });
    try {
      await get().fetchChannels();

      const existing = get().channels.find((channel) => channel.type === params.type);
      if (existing) {
        return existing;
      }

      return {
        id: `${params.type}-default`,
        type: params.type,
        name: params.name,
        status: 'connecting',
        configured: true,
        runtimeLoaded: false,
        runtimeStatus: 'unknown',
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

    // Configuration deletion is the authoritative operation. If it fails,
    // keep local UI state unchanged.
    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    await hostApiFetch(`/api/channels/config/${encodeURIComponent(channelType)}${query}`, {
      method: 'DELETE',
    });

    await get().fetchChannels();
  },

  setChannels: (channels) => set({ channels }),

  updateChannel: (channelId, updates) => {
    set((state) => ({
      channels: state.channels.map((channel) =>
        channel.id === channelId ? { ...channel, ...updates } : channel
      ),
    }));
  },

  clearError: () => set({ error: null }),
}));
