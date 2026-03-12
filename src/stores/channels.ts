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
  return channelTypes.find((type) => channelId === type || channelId.startsWith(`${type}-`));
}

interface ChannelsState {
  channels: Channel[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchChannels: () => Promise<void>;
  addChannel: (params: AddChannelParams) => Promise<Channel>;
  deleteChannel: (channelId: string) => Promise<void>;
  connectChannel: (channelId: string) => Promise<void>;
  disconnectChannel: (channelId: string) => Promise<void>;
  requestQrCode: (channelType: ChannelType) => Promise<{ qrCode: string; sessionId: string }>;
  setChannels: (channels: Channel[]) => void;
  updateChannel: (channelId: string, updates: Partial<Channel>) => void;
  clearError: () => void;
}

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  channels: [],
  loading: false,
  error: null,

  fetchChannels: async () => {
    set({ loading: true, error: null });
    const gatewayStatus = useGatewayStore.getState().status;

    if (gatewayStatus.state !== 'running') {
      set({ channels: [], loading: false });
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
      }>('channels.status', { probe: true }, 2500);
      if (data) {
        const channels: Channel[] = [];

        // Parse the complex channels.status response into simple Channel objects
        const channelOrder = data.channelOrder || Object.keys(data.channels || {});
        for (const channelId of channelOrder) {
          const summary = (data.channels as Record<string, unknown> | undefined)?.[channelId] as Record<string, unknown> | undefined;
          const configured =
            typeof summary?.configured === 'boolean'
              ? summary.configured
              : typeof (summary as { running?: boolean })?.running === 'boolean'
                ? true
                : false;
          if (!configured) continue;

          const accounts = data.channelAccounts?.[channelId] || [];
          const defaultAccountId = data.channelDefaultAccountId?.[channelId];
          const primaryAccount =
            (defaultAccountId ? accounts.find((a) => a.accountId === defaultAccountId) : undefined) ||
            accounts.find((a) => a.connected === true || a.linked === true) ||
            accounts[0];

          // Map gateway status to our status format
          let status: Channel['status'] = 'disconnected';
          const now = Date.now();
          const RECENT_MS = 10 * 60 * 1000;
          const hasRecentActivity = (a: { lastInboundAt?: number | null; lastOutboundAt?: number | null; lastConnectedAt?: number | null }) =>
            (typeof a.lastInboundAt === 'number' && now - a.lastInboundAt < RECENT_MS) ||
            (typeof a.lastOutboundAt === 'number' && now - a.lastOutboundAt < RECENT_MS) ||
            (typeof a.lastConnectedAt === 'number' && now - a.lastConnectedAt < RECENT_MS);
          const anyConnected = accounts.some((a) => a.connected === true || a.linked === true || hasRecentActivity(a));
          const anyRunning = accounts.some((a) => a.running === true);
          const summaryError =
            typeof (summary as { error?: string })?.error === 'string'
              ? (summary as { error?: string }).error
              : typeof (summary as { lastError?: string })?.lastError === 'string'
                ? (summary as { lastError?: string }).lastError
                : undefined;
          const anyError =
            accounts.some((a) => typeof a.lastError === 'string' && a.lastError) || Boolean(summaryError);

          if (anyConnected) {
            status = 'connected';
          } else if (anyRunning && !anyError) {
            status = 'connected';
          } else if (anyError) {
            status = 'error';
          } else if (anyRunning) {
            status = 'connecting';
          }

          channels.push({
            id: `${channelId}-${primaryAccount?.accountId || 'default'}`,
            type: channelId as ChannelType,
            name: primaryAccount?.name || CHANNEL_NAMES[channelId as ChannelType] || channelId,
            status,
            configured: true,
            runtimeLoaded: true,
            runtimeStatus: status,
            accountId: primaryAccount?.accountId,
            error:
              (typeof primaryAccount?.lastError === 'string' ? primaryAccount.lastError : undefined) ||
              (typeof summaryError === 'string' ? summaryError : undefined),
          });
        }

        set({ channels, loading: false });
      } else {
        // Gateway not available - try to show channels from local config
        set({ channels: [], loading: false });
      }
    } catch {
      // Gateway not connected, show empty
      set({ channels: [], loading: false });
    }
  },

  addChannel: async (params) => {
    set({ error: null });
    try {
      const result = await useGatewayStore.getState().rpc<Channel>('channels.add', params);
      if (!result) {
        throw new Error(`Gateway did not confirm channel creation for ${params.type}`);
      }
      await get().fetchChannels();
      return (
        get().channels.find((channel) => (
          channel.type === params.type
          && (result.accountId == null || channel.accountId === result.accountId)
        )) ?? result
      );
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteChannel: async (channelId) => {
    set({ error: null });
    const channelType = resolveChannelTypeFromId(channelId);
    if (!channelType) {
      throw new Error(`Unknown channel type for id: ${channelId}`);
    }

    // Configuration deletion is the authoritative operation. If it fails,
    // keep local UI state unchanged.
    await hostApiFetch(`/api/channels/config/${encodeURIComponent(channelType)}`, {
      method: 'DELETE',
    });

    try {
      await useGatewayStore.getState().rpc('channels.delete', { channelId: channelType });
    } catch (error) {
      console.error('Failed to delete channel from gateway:', error);
    }

    await get().fetchChannels();
  },

  connectChannel: async (channelId) => {
    const { updateChannel } = get();
    updateChannel(channelId, { status: 'connecting', error: undefined });

    try {
      await useGatewayStore.getState().rpc('channels.connect', { channelId });
      updateChannel(channelId, { status: 'connected' });
    } catch (error) {
      updateChannel(channelId, { status: 'error', error: String(error) });
    }
  },

  disconnectChannel: async (channelId) => {
    const { updateChannel } = get();

    try {
      await useGatewayStore.getState().rpc('channels.disconnect', { channelId });
    } catch (error) {
      console.error('Failed to disconnect channel:', error);
    }

    updateChannel(channelId, { status: 'disconnected', error: undefined });
  },

  requestQrCode: async (channelType) => {
    return await useGatewayStore.getState().rpc<{ qrCode: string; sessionId: string }>(
      'channels.requestQr',
      { type: channelType },
    );
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
