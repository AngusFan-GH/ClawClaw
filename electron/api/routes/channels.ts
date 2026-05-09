import type { IncomingMessage, ServerResponse } from 'http';
import { readFile, readdir } from 'node:fs/promises';
import { getOpenClawConfigDir } from '../../utils/paths';
import { getChannelsConfigSnapshot } from '../../services/config-snapshot';
import {
  deleteChannelConfig,
  getChannelFormValues,
  saveChannelConfig,
  setChannelEnabled,
  validateChannelConfig,
  validateChannelCredentials,
} from '../../utils/channel-config';
import { whatsAppLoginManager } from '../../utils/whatsapp-login';
import {
  buildQrChannelEventName,
  toUiChannelType,
  toRuntimeChannelType,
  WECHAT_RUNTIME_CHANNEL_ID,
  WECHAT_UI_CHANNEL_ID,
} from '../../utils/channel-alias';
import {
  cancelWeChatLoginSession,
  saveWeChatAccountState,
  startWeChatLoginSession,
  waitForWeChatLoginSession,
} from '../../utils/wechat-login';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { ensureBundledPluginInstalled } from '../../utils/bundled-plugin-installer';
import {
  assignChannelToAgent,
  clearAllChannelBindings,
  clearChannelBinding,
  listAgentsSnapshot,
} from '../../utils/agent-config';
import { beginChannelDraftSession } from '../../services/channel-draft-session';
import { extractSessionRecords } from '../../utils/session-util';
import { ensureWeChatPluginInstalled } from '../../utils/wechat-installer';
import type { ChannelType } from '../../../src/types/channel';

const WECHAT_QR_TIMEOUT_MS = 8 * 60 * 1000;
const activeQrLogins = new Map<string, string>();
const FORCE_RESTART_CHANNELS = new Set([
  'feishu',
  'dingtalk',
  'wecom',
  'whatsapp',
  'qqbot',
  WECHAT_RUNTIME_CHANNEL_ID,
]);

type ChannelsStatusSnapshot = {
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
    lastEventAt?: number | null;
  }>>;
  channelDefaultAccountId?: Record<string, string>;
};

type ChannelAccountView = {
  id: string;
  type: ChannelType;
  name: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error' | 'configured';
  configured: boolean;
  runtimeLoaded: boolean;
  runtimeStatus: 'connected' | 'disconnected' | 'connecting' | 'error' | 'configured' | 'unknown';
  accountId: string;
  isDefaultAccount: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
};

async function ensureDefaultAgentBindingForChannel(
  channelType: string,
  accountId?: string | null,
): Promise<boolean> {
  const runtimeChannelType = toRuntimeChannelType(channelType);
  const normalizedAccountId = accountId?.trim() || 'default';
  const snapshot = await listAgentsSnapshot();
  const accountKey = `${runtimeChannelType}:${normalizedAccountId}`;
  const existingOwner =
    snapshot.channelAccountOwners[accountKey]
    ?? snapshot.channelOwners[runtimeChannelType];
  if (existingOwner || !snapshot.defaultAgentId) {
    return false;
  }

  await beginChannelDraftSession();
  await assignChannelToAgent(snapshot.defaultAgentId, runtimeChannelType, normalizedAccountId, {
    mode: 'channel-draft',
  });
  return true;
}

type ChannelGroupView = {
  type: ChannelType;
  name: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error' | 'configured' | 'unknown';
  configured: boolean;
  runtimeLoaded: boolean;
  runtimeStatus: 'connected' | 'disconnected' | 'connecting' | 'error' | 'configured' | 'unknown';
  pluginLoaded: boolean;
  defaultAccountId?: string;
  configuredAccounts: string[];
  accounts: ChannelAccountView[];
  error?: string;
};

type JsonRecord = Record<string, unknown>;

type ChannelTargetOptionView = {
  value: string;
  label: string;
  kind: 'user' | 'group' | 'channel';
};

export function mapAccountStatus(account: {
  connected?: boolean;
  linked?: boolean;
  running?: boolean;
  lastError?: string;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastConnectedAt?: number | null;
  lastEventAt?: number | null;
}): ChannelAccountView['status'] {
  const now = Date.now();
  const recentMs = 10 * 60 * 1000;
  const hasRecentActivity =
    (typeof account.lastInboundAt === 'number' && now - account.lastInboundAt < recentMs) ||
    (typeof account.lastOutboundAt === 'number' && now - account.lastOutboundAt < recentMs) ||
    (typeof account.lastConnectedAt === 'number' && now - account.lastConnectedAt < recentMs) ||
    (typeof account.lastEventAt === 'number' && now - account.lastEventAt < recentMs);

  if (account.connected === true || account.linked === true || account.running === true || hasRecentActivity) {
    return 'connected';
  }
  if (typeof account.lastError === 'string' && account.lastError) {
    return 'error';
  }
  return 'disconnected';
}

export function normalizeAccountStatusForUi(params: {
  channelType: ChannelType;
  mappedStatus: ChannelAccountView['status'];
  configured?: boolean;
  lastError?: string;
  groupError?: string;
}): ChannelAccountView['status'] {
  return params.mappedStatus;
}

export function resolveRuntimeAccountIdForUi(params: {
  reportedAccountId?: string | null;
  configuredAccounts: string[];
  explicitDefaultAccountId?: string;
  runtimeConfigured?: boolean;
}): string | null {
  const normalizedReportedAccountId =
    typeof params.reportedAccountId === 'string' && params.reportedAccountId.trim()
      ? params.reportedAccountId.trim()
      : '';

  if (normalizedReportedAccountId && normalizedReportedAccountId !== 'default') {
    const configuredNamedAccounts = params.configuredAccounts.filter((accountId) => accountId !== 'default');
    const hasConfiguredDefault = params.configuredAccounts.includes('default');
    if (
      hasConfiguredDefault
      && configuredNamedAccounts.length === 0
    ) {
      return 'default';
    }
    return normalizedReportedAccountId;
  }

  const hasConfiguredDefault = params.configuredAccounts.includes('default');
  if (hasConfiguredDefault) {
    return 'default';
  }

  const configuredNamedAccounts = params.configuredAccounts.filter((accountId) => accountId !== 'default');
  if (params.runtimeConfigured === true) {
    return params.explicitDefaultAccountId || normalizedReportedAccountId || 'default';
  }

  if (configuredNamedAccounts.length === 1) {
    return configuredNamedAccounts[0];
  }

  if (configuredNamedAccounts.length > 1) {
    return null;
  }

  return normalizedReportedAccountId || 'default';
}

function isSummaryConnected(summary: Record<string, unknown> | undefined): boolean {
  if (!summary || typeof summary !== 'object') return false;
  return (
    summary.connected === true
    || summary.linked === true
    || summary.running === true
    || summary.status === 'connected'
    || summary.state === 'connected'
  );
}

export function promoteConnectedAccountFromSummary(params: {
  accounts: Map<string, ChannelAccountView>;
  summary: Record<string, unknown> | undefined;
  defaultAccountId?: string;
  type: ChannelType;
}): void {
  const { accounts, summary, defaultAccountId, type } = params;
  if (!isSummaryConnected(summary)) return;
  if (Array.from(accounts.values()).some((account) => account.status === 'connected')) return;

  const promotedAccountId = defaultAccountId || 'default';
  const prior = accounts.get(promotedAccountId);
  accounts.set(promotedAccountId, {
    id: `${type}:${promotedAccountId}`,
    type,
    name: prior?.name || type,
    status: 'connected',
    configured: prior?.configured ?? true,
    runtimeLoaded: true,
    runtimeStatus: 'connected',
    accountId: promotedAccountId,
    isDefaultAccount: promotedAccountId === (defaultAccountId || 'default'),
    error: undefined,
    metadata: {
      ...prior?.metadata,
      isDefaultAccount: promotedAccountId === (defaultAccountId || 'default'),
    },
  });
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
  lastEventAt?: number | null;
}): boolean {
  const status = mapAccountStatus(account);
  return Boolean(account.configured) || status === 'connected' || status === 'connecting';
}

export function resolveGroupStatus(group: ChannelGroupView): ChannelGroupView['status'] {
  if (group.accounts.some((account) => account.status === 'error' || Boolean(account.error)) || group.error) {
    return 'error';
  }
  if (group.accounts.some((account) => account.status === 'connected')) {
    return 'connected';
  }
  if (group.accounts.some((account) => account.status === 'connecting')) {
    return 'connecting';
  }
  if (group.configured || group.accounts.some((account) => account.configured)) {
    return 'configured';
  }
  if (group.runtimeLoaded) {
    return 'disconnected';
  }
  return 'unknown';
}

function buildChannelTargetLabel(baseLabel: string, value: string): string {
  const trimmed = baseLabel.trim();
  return trimmed && trimmed !== value ? `${trimmed} (${value})` : value;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function inferTargetKindFromValue(
  channelType: string,
  target: string,
  chatType?: string,
): ChannelTargetOptionView['kind'] {
  const normalizedChatType = chatType?.trim().toLowerCase();
  if (normalizedChatType === 'group') return 'group';
  if (normalizedChatType === 'channel') return 'channel';
  if (target.startsWith('chat:') || target.includes(':group:')) return 'group';
  if (target.includes(':channel:')) return 'channel';
  if (channelType === 'dingtalk' && target.startsWith('cid')) return 'group';
  return 'user';
}

async function listSessionDerivedTargetOptions(params: {
  channelType: string;
  accountId?: string;
  query?: string;
}): Promise<ChannelTargetOptionView[]> {
  const storedChannelType = toRuntimeChannelType(params.channelType);
  const agentsDir = join(getOpenClawConfigDir(), 'agents');
  const agentDirs = await readdir(agentsDir, { withFileTypes: true }).catch(() => []);
  const q = params.query?.trim().toLowerCase() || '';
  const candidates: Array<ChannelTargetOptionView & { updatedAt: number }> = [];
  const seen = new Set<string>();

  for (const entry of agentDirs) {
    if (!entry.isDirectory()) continue;
    const sessionsPath = join(agentsDir, entry.name, 'sessions', 'sessions.json');
    const raw = await readFile(sessionsPath, 'utf8').catch(() => '');
    if (!raw.trim()) continue;

    let parsed: JsonRecord;
    try {
      parsed = JSON.parse(raw) as JsonRecord;
    } catch {
      continue;
    }

    for (const session of extractSessionRecords(parsed)) {
      const deliveryContext = session.deliveryContext && typeof session.deliveryContext === 'object'
        ? session.deliveryContext as JsonRecord
        : undefined;
      const origin = session.origin && typeof session.origin === 'object'
        ? session.origin as JsonRecord
        : undefined;
      const sessionChannelType = readNonEmptyString(deliveryContext?.channel)
        || readNonEmptyString(session.lastChannel)
        || readNonEmptyString(session.channel)
        || readNonEmptyString(origin?.provider)
        || readNonEmptyString(origin?.surface);
      if (!sessionChannelType || toRuntimeChannelType(sessionChannelType) !== storedChannelType) {
        continue;
      }

      const sessionAccountId = readNonEmptyString(deliveryContext?.accountId)
        || readNonEmptyString(session.lastAccountId)
        || readNonEmptyString(origin?.accountId);
      if (params.accountId && sessionAccountId && sessionAccountId !== params.accountId) {
        continue;
      }
      if (params.accountId && !sessionAccountId) {
        continue;
      }

      const value = readNonEmptyString(deliveryContext?.to)
        || readNonEmptyString(session.lastTo)
        || readNonEmptyString(origin?.to);
      if (!value || seen.has(value)) continue;

      const labelBase = readNonEmptyString(session.displayName)
        || readNonEmptyString(session.subject)
        || readNonEmptyString(origin?.label)
        || value;
      const label = buildChannelTargetLabel(labelBase, value);
      if (q && !label.toLowerCase().includes(q) && !value.toLowerCase().includes(q)) {
        continue;
      }

      seen.add(value);
      candidates.push({
        value,
        label,
        kind: inferTargetKindFromValue(
          storedChannelType,
          value,
          readNonEmptyString(session.chatType) || readNonEmptyString(origin?.chatType),
        ),
        updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : 0,
      });
    }
  }

  return candidates
    .sort((left, right) => right.updatedAt - left.updatedAt || left.label.localeCompare(right.label))
    .map(({ updatedAt: _updatedAt, ...option }) => option);
}

async function buildChannelAccountsView(
  ctx: HostApiContext,
  options?: { includeRuntime?: boolean; probe?: boolean },
): Promise<ChannelGroupView[]> {
  const { groups: configuredGroups, accountsByType: configuredAccountsByType } = await getChannelsConfigSnapshot();

  let runtimeSnapshot: ChannelsStatusSnapshot | undefined;
  if (
    options?.includeRuntime !== false
    && ctx.gatewayManager.getStatus().state === 'running'
    && !ctx.gatewayManager.isInStartupStabilizationWindow()
  ) {
    try {
      runtimeSnapshot = await ctx.gatewayManager.rpc<ChannelsStatusSnapshot>(
        'channels.status',
        { probe: options?.probe ?? false, timeoutMs: 8000 },
        9000,
      );
    } catch {
      runtimeSnapshot = undefined;
    }
  }

  const groups = new Map<ChannelType, ChannelGroupView>();
  for (const group of configuredGroups) {
    const type = group.type as ChannelType;
    const configuredAccountIds = configuredAccountsByType[group.type] ?? group.accounts.map((account) => account.accountId);
    groups.set(type, {
      type,
      name: type,
      status: 'configured',
      configured: group.configured,
      runtimeLoaded: false,
      runtimeStatus: 'unknown',
      pluginLoaded: false,
      defaultAccountId: group.defaultAccountId,
      configuredAccounts: configuredAccountIds,
      accounts: group.accounts.map((account) => ({
        id: `${type}:${account.accountId}`,
        type,
        name: type,
        status: 'configured',
        configured: account.configured,
        runtimeLoaded: false,
        runtimeStatus: 'unknown',
        accountId: account.accountId,
        isDefaultAccount: account.isDefaultAccount,
        metadata: {
          isDefaultAccount: account.isDefaultAccount,
        },
      })),
    });
  }

  if (runtimeSnapshot) {
    const channelOrder = runtimeSnapshot.channelOrder || Object.keys(runtimeSnapshot.channels || {});
    for (const rawChannelId of channelOrder) {
      const channelId = rawChannelId === 'openclaw-weixin' ? 'wechat' : rawChannelId;
      const type = channelId as ChannelType;
      const existing = groups.get(type);
      if (!existing) {
        continue;
      }
      const summary = (runtimeSnapshot.channels as Record<string, unknown> | undefined)?.[rawChannelId] as Record<string, unknown> | undefined;
      const summaryError =
        typeof (summary as { error?: string })?.error === 'string'
          ? (summary as { error?: string }).error
          : typeof (summary as { lastError?: string })?.lastError === 'string'
            ? (summary as { lastError?: string }).lastError
            : undefined;
      const defaultAccountId = runtimeSnapshot.channelDefaultAccountId?.[rawChannelId];
      const runtimeAccounts = runtimeSnapshot.channelAccounts?.[rawChannelId] || [];

      const keptRuntimeAccounts = runtimeAccounts.filter((a) => shouldKeepRuntimeAccount(a));
      const hasRuntimeData = keptRuntimeAccounts.length > 0;
      const configuredAccounts = Array.from(new Set([
        ...existing.configuredAccounts,
        ...runtimeAccounts
          .filter((account) => account.configured === true)
          .map((account) => account.accountId || 'default'),
      ]));
      const resolvedDefaultAccountId =
        defaultAccountId
        || existing.defaultAccountId
        || (() => {
          const configuredNamedAccounts = configuredAccounts.filter((accountId) => accountId !== 'default');
          if (configuredAccounts.includes('default')) return 'default';
          if (configuredNamedAccounts.length === 1) return configuredNamedAccounts[0];
          return undefined;
        })();

      const accountMap = new Map(existing.accounts.map((account) => [account.accountId, account]));
      for (const runtimeAccount of runtimeAccounts) {
        if (!shouldKeepRuntimeAccount(runtimeAccount)) continue;
        const accountId = resolveRuntimeAccountIdForUi({
          reportedAccountId: runtimeAccount.accountId,
          configuredAccounts: existing.configuredAccounts,
          explicitDefaultAccountId: resolvedDefaultAccountId,
          runtimeConfigured: runtimeAccount.configured,
        });
        if (!accountId) {
          continue;
        }
        const mappedStatus = mapAccountStatus(runtimeAccount);
        const status = normalizeAccountStatusForUi({
          channelType: type,
          mappedStatus,
          configured: runtimeAccount.configured ?? true,
          lastError: runtimeAccount.lastError,
          groupError: summaryError,
        });
        const prior = accountMap.get(accountId);
        accountMap.set(accountId, {
          id: `${type}:${accountId}`,
          type,
          name: runtimeAccount.name || prior?.name || type,
          status,
          configured: runtimeAccount.configured ?? prior?.configured ?? existing.configuredAccounts.includes(accountId),
          runtimeLoaded: true,
          runtimeStatus: status,
          accountId,
          isDefaultAccount: accountId === (resolvedDefaultAccountId || 'default'),
          error: status === 'error' ? (runtimeAccount.lastError || summaryError || prior?.error) : undefined,
          metadata: {
            ...prior?.metadata,
            isDefaultAccount: accountId === (resolvedDefaultAccountId || 'default'),
          },
        });
      }

      promoteConnectedAccountFromSummary({
        accounts: accountMap,
        summary,
        defaultAccountId: resolvedDefaultAccountId,
        type,
      });

      const nextGroup: ChannelGroupView = {
        ...existing,
        configured: existing.configured || runtimeAccounts.some((account) => account.configured === true),
        runtimeLoaded: hasRuntimeData,
        pluginLoaded: true,
        defaultAccountId: resolvedDefaultAccountId,
        configuredAccounts,
        accounts: Array.from(accountMap.values()).sort((left, right) => {
          if (left.isDefaultAccount !== right.isDefaultAccount) {
            return left.isDefaultAccount ? -1 : 1;
          }
          return left.accountId.localeCompare(right.accountId);
        }),
        error: resolveGroupStatus({
          ...existing,
          accounts: Array.from(accountMap.values()),
          configured: existing.configured || runtimeAccounts.some((account) => account.configured === true),
          runtimeLoaded: hasRuntimeData,
          pluginLoaded: true,
          defaultAccountId: resolvedDefaultAccountId,
          configuredAccounts,
          error: undefined,
          runtimeStatus: 'unknown',
          status: 'unknown',
          name: existing.name,
          type,
        }) === 'error' ? (summaryError || existing.error) : undefined,
        runtimeStatus: 'unknown',
        status: 'unknown',
      };
      nextGroup.runtimeStatus = resolveGroupStatus(nextGroup);
      nextGroup.status = nextGroup.runtimeStatus;
      groups.set(type, nextGroup);
    }
  }

  return Array.from(groups.values())
    .map((group) => {
      const status = resolveGroupStatus(group);
      return {
        ...group,
        name: group.name === group.type ? group.type : group.name,
        status,
        runtimeStatus: group.runtimeLoaded ? status : group.runtimeStatus,
      };
    })
    .filter((group) =>
      group.configured
      || group.accounts.some((account) => account.configured || account.status === 'connected' || account.status === 'connecting' || Boolean(account.error)),
    );
}

function scheduleGatewayChannelRefresh(
  ctx: HostApiContext,
  channelType: string,
  reason: string,
  _options?: { mode?: 'debounced' | 'immediate'; awaitCompletion?: boolean },
): void {
  const requires = FORCE_RESTART_CHANNELS.has(channelType)
    ? 'restart'
    : 'reload';
  ctx.runtimeApplyPlan.record({
    domain: 'channels',
    label: '连接配置',
    source: reason,
    reason,
    requires,
  });
}

function toComparableConfig(input: Record<string, unknown>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      next[key] = value.trim();
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      next[key] = String(value);
    }
  }
  return next;
}

function isSameConfigValues(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): boolean {
  if (!existing) return false;
  const current = toComparableConfig(existing);
  const next = toComparableConfig(incoming);
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  if (keys.size === 0) return false;
  for (const key of keys) {
    if ((current[key] ?? '') !== (next[key] ?? '')) {
      return false;
    }
  }
  return true;
}

async function ensureDingTalkPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  return ensureBundledPluginInstalled('dingtalk', 'DingTalk', { forceReinstall: true });
}

async function ensureFeishuPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  return ensureBundledPluginInstalled('feishu', 'Feishu / Lark', { forceReinstall: true });
}

async function ensureQQBotPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  return { installed: true };
}

function buildQrLoginKey(channelType: string, accountId?: string): string {
  return `${channelType}:${accountId?.trim() || '__new__'}`;
}

function setActiveQrLogin(channelType: string, sessionKey: string, accountId?: string): string {
  const loginKey = buildQrLoginKey(channelType, accountId);
  activeQrLogins.set(loginKey, sessionKey);
  return loginKey;
}

function isActiveQrLogin(loginKey: string, sessionKey: string): boolean {
  return activeQrLogins.get(loginKey) === sessionKey;
}

function clearActiveQrLogin(channelType: string, accountId?: string): void {
  activeQrLogins.delete(buildQrLoginKey(channelType, accountId));
}

function emitChannelEvent(
  ctx: HostApiContext,
  channelType: string,
  event: 'qr' | 'success' | 'error',
  payload: unknown,
): void {
  const eventName = buildQrChannelEventName(channelType, event);
  ctx.eventBus.emit(eventName, payload);
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send(eventName, payload);
  }
}

async function awaitWeChatQrLogin(
  ctx: HostApiContext,
  sessionKey: string,
  loginKey: string,
  accountId?: string,
): Promise<void> {
  try {
    const result = await waitForWeChatLoginSession({
      sessionKey,
      accountId,
      timeoutMs: WECHAT_QR_TIMEOUT_MS,
      onQrRefresh: async ({ qrcodeUrl }) => {
        if (!isActiveQrLogin(loginKey, sessionKey)) return;
        emitChannelEvent(ctx, WECHAT_UI_CHANNEL_ID, 'qr', {
          qr: qrcodeUrl,
          raw: qrcodeUrl,
          sessionKey,
        });
      },
    });

    if (!isActiveQrLogin(loginKey, sessionKey)) {
      return;
    }

    if (!result.connected || !result.accountId || !result.botToken) {
      emitChannelEvent(
        ctx,
        WECHAT_UI_CHANNEL_ID,
        'error',
        result.message || 'WeChat login did not complete',
      );
      return;
    }

    const normalizedAccountId = await saveWeChatAccountState(result.accountId, {
      token: result.botToken,
      baseUrl: result.baseUrl,
      userId: result.userId,
    });

    await saveChannelConfig(WECHAT_UI_CHANNEL_ID, {
      enabled: true,
      __accountId: normalizedAccountId,
    });
    await ensureDefaultAgentBindingForChannel(WECHAT_RUNTIME_CHANNEL_ID, normalizedAccountId);

    if (!isActiveQrLogin(loginKey, sessionKey)) {
      return;
    }

    emitChannelEvent(ctx, WECHAT_UI_CHANNEL_ID, 'success', {
      accountId: normalizedAccountId,
      rawAccountId: result.accountId,
      message: result.message,
    });

    try {
      scheduleGatewayChannelRefresh(ctx, WECHAT_RUNTIME_CHANNEL_ID, `channel:saveConfig:${WECHAT_RUNTIME_CHANNEL_ID}`);
    } catch (refreshError) {
      console.warn('Failed to enqueue Gateway refresh after WeChat login:', refreshError);
    }
  } catch (error) {
    if (!isActiveQrLogin(loginKey, sessionKey)) {
      return;
    }
    emitChannelEvent(ctx, WECHAT_UI_CHANNEL_ID, 'error', String(error));
  } finally {
    if (isActiveQrLogin(loginKey, sessionKey)) {
      activeQrLogins.delete(loginKey);
    }
    await cancelWeChatLoginSession(sessionKey);
  }
}

export async function handleChannelRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/channels/accounts' && req.method === 'GET') {
    try {
      const includeRuntime = url.searchParams.get('includeRuntime') !== 'false';
      const probe = url.searchParams.get('probe') === 'true';
      const channels = await buildChannelAccountsView(ctx, { includeRuntime, probe });
      sendJson(res, 200, { success: true, channels });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/targets' && req.method === 'GET') {
    try {
      const channelType = url.searchParams.get('channelType')?.trim() || '';
      const accountId = url.searchParams.get('accountId')?.trim() || undefined;
      const query = url.searchParams.get('query')?.trim() || undefined;
      if (!channelType) {
        sendJson(res, 400, { success: false, error: 'channelType is required' });
        return true;
      }

      const targets = await listSessionDerivedTargetOptions({ channelType, accountId, query });
      sendJson(res, 200, {
        success: true,
        channelType: toUiChannelType(channelType),
        accountId,
        targets,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config/validate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string }>(req);
      sendJson(res, 200, { success: true, ...(await validateChannelConfig(body.channelType)) });
    } catch (error) {
      sendJson(res, 500, { success: false, valid: false, errors: [String(error)], warnings: [] });
    }
    return true;
  }

  if (url.pathname === '/api/channels/credentials/validate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string; config: Record<string, string> }>(req);
      sendJson(res, 200, { success: true, ...(await validateChannelCredentials(body.channelType, body.config)) });
    } catch (error) {
      sendJson(res, 500, { success: false, valid: false, errors: [String(error)], warnings: [] });
    }
    return true;
  }

  if (url.pathname === '/api/channels/whatsapp/start' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId: string }>(req);
      await whatsAppLoginManager.start(body.accountId);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/whatsapp/cancel' && req.method === 'POST') {
    try {
      await whatsAppLoginManager.stop();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if ((url.pathname === '/api/channels/wechat/start' || url.pathname === '/api/channels/wechat/install') && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId?: string }>(req);
      const requestedAccountId = body.accountId?.trim() || undefined;

      const installResult = await ensureWeChatPluginInstalled();
      if (!installResult.installed) {
        sendJson(res, 500, { success: false, error: installResult.warning || 'WeChat plugin install failed' });
        return true;
      }

      const startResult = await startWeChatLoginSession({
        ...(requestedAccountId ? { accountId: requestedAccountId } : {}),
        force: true,
      });

      if (!startResult.qrcodeUrl || !startResult.sessionKey) {
        throw new Error(startResult.message || 'Failed to generate WeChat QR code');
      }

      const loginKey = setActiveQrLogin(WECHAT_UI_CHANNEL_ID, startResult.sessionKey, requestedAccountId);
      emitChannelEvent(ctx, WECHAT_UI_CHANNEL_ID, 'qr', {
        qr: startResult.qrcodeUrl,
        raw: startResult.qrcodeUrl,
        sessionKey: startResult.sessionKey,
      });
      void awaitWeChatQrLogin(ctx, startResult.sessionKey, loginKey, requestedAccountId);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/wechat/cancel' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ accountId?: string }>(req);
      const accountId = body.accountId?.trim() || undefined;
      const loginKey = buildQrLoginKey(WECHAT_UI_CHANNEL_ID, accountId);
      const sessionKey = activeQrLogins.get(loginKey);
      clearActiveQrLogin(WECHAT_UI_CHANNEL_ID, accountId);
      if (sessionKey) {
        await cancelWeChatLoginSession(sessionKey);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        channelType: string;
        config: Record<string, unknown>;
        skipRestart?: boolean;
      }>(req);
      const runtimeChannelType = toRuntimeChannelType(body.channelType);
      if (runtimeChannelType === 'dingtalk') {
        const installResult = await ensureDingTalkPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'DingTalk plugin install failed' });
          return true;
        }
      }
      if (runtimeChannelType === 'feishu') {
        const installResult = await ensureFeishuPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'Feishu plugin install failed' });
          return true;
        }
      }
      if (runtimeChannelType === 'qqbot') {
        const installResult = await ensureQQBotPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'QQ Bot plugin install failed' });
          return true;
        }
      }
      if (runtimeChannelType === WECHAT_RUNTIME_CHANNEL_ID) {
        const installResult = await ensureWeChatPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'WeChat plugin install failed' });
          return true;
        }
      }
      const existingValues = await getChannelFormValues(body.channelType, body.config.__accountId as string | undefined);
      if (isSameConfigValues(existingValues ?? undefined, body.config)) {
        const bindingAdded = body.config.enabled !== false
          ? await ensureDefaultAgentBindingForChannel(runtimeChannelType, body.config.__accountId as string | undefined)
          : false;
        if (bindingAdded && !body.skipRestart) {
          scheduleGatewayChannelRefresh(ctx, runtimeChannelType, `channel:saveConfig:${runtimeChannelType}`);
        }
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      await saveChannelConfig(body.channelType, body.config);
      if (body.config.enabled !== false) {
        await ensureDefaultAgentBindingForChannel(runtimeChannelType, body.config.__accountId as string | undefined);
      }
      if (!body.skipRestart) {
        scheduleGatewayChannelRefresh(ctx, runtimeChannelType, `channel:saveConfig:${runtimeChannelType}`);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/config/enabled' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ channelType: string; enabled: boolean; accountId?: string }>(req);
      await setChannelEnabled(body.channelType, body.enabled, body.accountId);
      scheduleGatewayChannelRefresh(ctx, toRuntimeChannelType(body.channelType), `channel:setEnabled:${body.channelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/channels/config/') && req.method === 'GET') {
    try {
      const channelType = decodeURIComponent(url.pathname.slice('/api/channels/config/'.length));
      const accountId = url.searchParams.get('accountId');
      sendJson(res, 200, {
        success: true,
        values: await getChannelFormValues(channelType, accountId),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/channels/config/') && req.method === 'DELETE') {
    try {
      const channelType = decodeURIComponent(url.pathname.slice('/api/channels/config/'.length));
      const accountId = url.searchParams.get('accountId');
      await deleteChannelConfig(channelType, accountId);
      if (accountId) {
        await clearChannelBinding(channelType, undefined, accountId, { mode: 'channel-draft' }).catch(() => undefined);
      } else {
        await clearAllChannelBindings(channelType, { mode: 'channel-draft' }).catch(() => undefined);
      }
      ctx.runtimeApplyPlan.record({
        domain: 'channels',
        label: '连接配置',
        source: `channel:deleteConfig:${channelType}`,
        reason: `channel:deleteConfig:${channelType}`,
        requires: FORCE_RESTART_CHANNELS.has(toRuntimeChannelType(channelType)) ? 'restart' : 'reload',
      });
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  void ctx;
  return false;
}
