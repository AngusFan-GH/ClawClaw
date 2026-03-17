import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { useGatewayStore } from './gateway';
import type { Channel, ChannelAccount, ChannelGroup, ChannelType } from '../types/channel';
import { CHANNEL_NAMES } from '../types/channel';

interface AddChannelParams {
  type: ChannelType;
  name: string;
  token?: string;
}

interface ConfiguredChannelGroupSnapshot {
  type: string;
  defaultAccountId?: string;
  configured: boolean;
  accounts: Array<{
    accountId: string;
    isDefaultAccount: boolean;
    configured: boolean;
  }>;
}

interface ChannelsStatusSnapshot {
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
}

interface ChannelsState {
  channelGroups: ChannelGroup[];
  channels: Channel[];
  loading: boolean;
  error: string | null;
  fetchChannels: (probe?: boolean, options?: { includeRuntime?: boolean }) => Promise<void>;
  addChannel: (params: AddChannelParams) => Promise<Channel>;
  deleteChannel: (channelId: string, accountId?: string) => Promise<void>;
  setChannelGroups: (groups: ChannelGroup[]) => void;
  clearError: () => void;
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
    }))
  );
}

function mapAccountStatus(account: {
  connected?: boolean;
  linked?: boolean;
  running?: boolean;
  lastError?: string;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastConnectedAt?: number | null;
}): ChannelAccount['status'] {
  const now = Date.now();
  const recentMs = 10 * 60 * 1000;
  const hasRecentActivity =
    (typeof account.lastInboundAt === 'number' && now - account.lastInboundAt < recentMs) ||
    (typeof account.lastOutboundAt === 'number' && now - account.lastOutboundAt < recentMs) ||
    (typeof account.lastConnectedAt === 'number' && now - account.lastConnectedAt < recentMs);

  if (typeof account.lastError === 'string' && account.lastError) {
    return 'error';
  }
  if (account.connected === true || account.linked === true || hasRecentActivity) {
    return 'connected';
  }
  if (account.running === true) {
    return 'connecting';
  }
  return 'disconnected';
}

function shouldKeepRuntimeAccount(account: {
  configured?: boolean;
  connected?: boolean;
  linked?: boolean;
  running?: boolean;
  lastError?: string;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastConnectedAt?: number | null;
}): boolean {
  const status = mapAccountStatus(account);
  return Boolean(account.configured) || status === 'connected' || status === 'connecting' || Boolean(account.lastError);
}

function isGroupVisible(group: ChannelGroup): boolean {
  if (group.configured) {
    return true;
  }
  return group.accounts.some((account) =>
    account.configured ||
    account.status === 'connected' ||
    account.status === 'connecting' ||
    Boolean(account.error)
  );
}

function resolveGroupStatus(group: ChannelGroup): ChannelGroup['status'] {
  const accounts = group.accounts;
  if (accounts.some((account) => account.status === 'error' || Boolean(account.error)) || group.error) {
    return 'error';
  }
  if (accounts.some((account) => account.status === 'connected')) {
    return 'connected';
  }
  if (accounts.some((account) => account.status === 'connecting')) {
    return 'connecting';
  }
  if (group.configured || accounts.some((account) => account.configured)) {
    return 'configured';
  }
  if (group.runtimeLoaded) {
    return 'disconnected';
  }
  return 'unknown';
}

function buildInitialGroups(configuredGroups: ConfiguredChannelGroupSnapshot[]): Map<ChannelType, ChannelGroup> {
  const map = new Map<ChannelType, ChannelGroup>();

  for (const group of configuredGroups) {
    if (!(group.type in CHANNEL_NAMES)) continue;
    const type = group.type as ChannelType;
    const accounts = group.accounts.map<ChannelAccount>((account) => ({
      id: `${type}:${account.accountId}`,
      type,
      name: CHANNEL_NAMES[type] || type,
      status: 'configured',
      configured: account.configured,
      runtimeLoaded: false,
      runtimeStatus: 'unknown',
      accountId: account.accountId,
      isDefaultAccount: account.isDefaultAccount,
      metadata: {
        isDefaultAccount: account.isDefaultAccount,
      },
    }));

    map.set(type, {
      type,
      name: CHANNEL_NAMES[type] || type,
      status: accounts.length > 0 ? 'configured' : 'unknown',
      configured: group.configured,
      runtimeLoaded: false,
      runtimeStatus: accounts.length > 0 ? 'configured' : 'unknown',
      pluginLoaded: false,
      defaultAccountId: group.defaultAccountId,
      configuredAccounts: group.accounts.map((account) => account.accountId),
      accounts,
    });
  }

  return map;
}

function mergeRuntimeSnapshot(
  groups: Map<ChannelType, ChannelGroup>,
  snapshot: ChannelsStatusSnapshot | undefined,
): void {
  if (!snapshot) return;

  const channelOrder = snapshot.channelOrder || Object.keys(snapshot.channels || {});
  for (const channelId of channelOrder) {
    if (!(channelId in CHANNEL_NAMES)) continue;
    const type = channelId as ChannelType;
    const summary = (snapshot.channels as Record<string, unknown> | undefined)?.[channelId] as Record<string, unknown> | undefined;
    const summaryError =
      typeof (summary as { error?: string })?.error === 'string'
        ? (summary as { error?: string }).error
        : typeof (summary as { lastError?: string })?.lastError === 'string'
          ? (summary as { lastError?: string }).lastError
          : undefined;
    const defaultAccountId = snapshot.channelDefaultAccountId?.[channelId];
    const runtimeAccounts = snapshot.channelAccounts?.[channelId] || [];

    const existing = groups.get(type) || {
      type,
      name: CHANNEL_NAMES[type] || type,
      status: 'unknown' as const,
      configured: false,
      runtimeLoaded: false,
      runtimeStatus: 'unknown' as const,
      pluginLoaded: false,
      defaultAccountId,
      configuredAccounts: [],
      accounts: [],
    };

    const accountMap = new Map(existing.accounts.map((account) => [account.accountId, account]));
    for (const runtimeAccount of runtimeAccounts) {
      if (!shouldKeepRuntimeAccount(runtimeAccount)) {
        continue;
      }
      const accountId = runtimeAccount.accountId || 'default';
      const status = mapAccountStatus(runtimeAccount);
      const prior = accountMap.get(accountId);
      accountMap.set(accountId, {
        id: `${type}:${accountId}`,
        type,
        name: runtimeAccount.name || prior?.name || CHANNEL_NAMES[type] || type,
        status,
        configured: runtimeAccount.configured ?? prior?.configured ?? true,
        runtimeLoaded: true,
        runtimeStatus: status,
        accountId,
        isDefaultAccount: accountId === (defaultAccountId || 'default'),
        error: runtimeAccount.lastError || summaryError || prior?.error,
        metadata: {
          ...prior?.metadata,
          isDefaultAccount: accountId === (defaultAccountId || 'default'),
        },
      });
    }

    const nextGroup: ChannelGroup = {
      ...existing,
      configured: existing.configured || runtimeAccounts.some((account) => account.configured === true),
      runtimeLoaded: true,
      pluginLoaded: true,
      defaultAccountId: defaultAccountId || existing.defaultAccountId,
      configuredAccounts: Array.from(new Set([
        ...existing.configuredAccounts,
        ...runtimeAccounts.filter((account) => account.configured === true).map((account) => account.accountId || 'default'),
      ])),
      accounts: Array.from(accountMap.values()).sort((left, right) => {
        if (left.isDefaultAccount !== right.isDefaultAccount) {
          return left.isDefaultAccount ? -1 : 1;
        }
        return left.accountId.localeCompare(right.accountId);
      }),
      error: summaryError || existing.error,
      runtimeStatus: 'unknown',
      status: 'unknown',
    };

    nextGroup.runtimeStatus = resolveGroupStatus(nextGroup);
    nextGroup.status = nextGroup.runtimeStatus;
    groups.set(type, nextGroup);
  }
}

async function fetchConfiguredChannelGroups(): Promise<ConfiguredChannelGroupSnapshot[]> {
  const result = await hostApiFetch<{
    success: boolean;
    groups?: ConfiguredChannelGroupSnapshot[];
  }>('/api/channels/configured');
  return result.success && Array.isArray(result.groups) ? result.groups : [];
}

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  channelGroups: [],
  channels: [],
  loading: false,
  error: null,

  fetchChannels: async (probe = false, options) => {
    set({ loading: true, error: null });
    try {
      const configuredGroups = await fetchConfiguredChannelGroups();
      const groups = buildInitialGroups(configuredGroups);
      const gatewayStatus = useGatewayStore.getState().status;
      const gatewayLifecycle = useGatewayStore.getState().lifecycle;
      const includeRuntime = options?.includeRuntime ?? (
        gatewayStatus.state === 'running' &&
        gatewayLifecycle.state !== 'scheduled' &&
        gatewayLifecycle.state !== 'applying'
      );

      if (includeRuntime) {
        const runtimeSnapshot = await useGatewayStore.getState().rpc<ChannelsStatusSnapshot>(
          'channels.status',
          { probe, timeoutMs: 8000 },
          9000,
        );
        mergeRuntimeSnapshot(groups, runtimeSnapshot);
      }

      const finalGroups = Array.from(groups.values())
        .map((group) => {
          const status = resolveGroupStatus(group);
          return {
            ...group,
            status,
            runtimeStatus: group.runtimeLoaded ? status : group.runtimeStatus,
          };
        })
        .filter(isGroupVisible)
        .sort((left, right) => left.name.localeCompare(right.name));

      set({
        channelGroups: finalGroups,
        channels: flattenGroups(finalGroups),
        loading: false,
      });
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

    await get().fetchChannels(false, { includeRuntime: false });
  },

  setChannelGroups: (groups) => set({ channelGroups: groups, channels: flattenGroups(groups) }),

  clearError: () => set({ error: null }),
}));
