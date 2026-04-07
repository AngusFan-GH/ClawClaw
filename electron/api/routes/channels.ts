import type { IncomingMessage, ServerResponse } from 'http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  deleteChannelConfig,
  getChannelFormValues,
  listConfiguredChannelAccounts,
  listConfiguredChannelGroups,
  saveChannelConfig,
  setChannelEnabled,
  validateChannelConfig,
  validateChannelCredentials,
} from '../../utils/channel-config';
import { whatsAppLoginManager } from '../../utils/whatsapp-login';
import {
  buildQrChannelEventName,
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
import { getOpenClawCliSpawnConfig } from '../../utils/openclaw-cli';
import { clearAllChannelBindings, clearChannelBinding } from '../../utils/agent-config';
import { repairManagedPluginSdkImports } from '../../utils/plugin-sdk-compat';
import type { ChannelType } from '../../../src/types/channel';

const WECHAT_QR_TIMEOUT_MS = 8 * 60 * 1000;
const activeQrLogins = new Map<string, string>();
const WECHAT_PLUGIN_SPEC = '@tencent-weixin/openclaw-weixin';
const WECHAT_PLUGIN_NPM_ONLY_SPEC = `npm:${WECHAT_PLUGIN_SPEC}`;
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

function looksLikeUtf16Le(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer.length % 2 !== 0) {
    return false;
  }

  let zeroBytes = 0;
  let oddZeroBytes = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] !== 0) {
      continue;
    }
    zeroBytes += 1;
    if (i % 2 === 1) {
      oddZeroBytes += 1;
    }
  }

  return zeroBytes >= Math.floor(buffer.length / 4) && oddZeroBytes >= Math.floor(zeroBytes * 0.8);
}

export function decodeCliInstallOutput(chunk: Buffer | string): string {
  if (typeof chunk === 'string') {
    return chunk.replace(/\u0000/g, '');
  }

  const decoded = looksLikeUtf16Le(chunk) ? chunk.toString('utf16le') : chunk.toString('utf8');
  return decoded.replace(/\u0000/g, '');
}

export function formatWeChatPluginInstallError(raw: string): string {
  const trimmed = raw.replace(/\u0000/g, '').trim();
  if (!trimmed) {
    return 'WeChat plugin install failed.';
  }

  const pluginOnly = trimmed.replace(/\nAlso not a valid hook pack:.*$/s, '').trim();
  if (/ClawHub\/api\/v1\/packages\/.+failed \(429\):/i.test(pluginOnly) || /Ratelimit exceeded/i.test(pluginOnly)) {
    return 'ClawHub rate limit exceeded while resolving the WeChat plugin. Please retry in a moment.';
  }

  return pluginOnly;
}

async function runOpenClawPluginCommand(args: string[]): Promise<void> {
  const spawnConfig = getOpenClawCliSpawnConfig(args);
  const INSTALL_TIMEOUT_MS = 120_000;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd,
      env: spawnConfig.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const killTimer = setTimeout(() => {
      console.warn('[runOpenClawPluginCommand] Installation timed out, killing child process');
      child.kill('SIGTERM');
    }, INSTALL_TIMEOUT_MS);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.once('error', (err) => {
      clearTimeout(killTimer);
      reject(err);
    });
    child.once('close', (code, signal) => {
      clearTimeout(killTimer);
      if (code === 0) {
        resolve();
        return;
      }

      const stderr = decodeCliInstallOutput(Buffer.concat(stderrChunks)).trim();
      const stdout = decodeCliInstallOutput(Buffer.concat(stdoutChunks)).trim();
      const detail = formatWeChatPluginInstallError(stderr || stdout);
      reject(new Error(
        detail || `WeChat plugin install failed with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`,
      ));
    });
  });
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

async function buildChannelAccountsView(
  ctx: HostApiContext,
  options?: { includeRuntime?: boolean; probe?: boolean },
): Promise<ChannelGroupView[]> {
  const [configuredGroups, configuredAccountsByType] = await Promise.all([
    listConfiguredChannelGroups({ includeCli: false }),
    listConfiguredChannelAccounts({ includeCli: false }),
  ]);

  let runtimeSnapshot: ChannelsStatusSnapshot | undefined;
  if (options?.includeRuntime !== false && ctx.gatewayManager.getStatus().state === 'running') {
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
  options?: { mode?: 'debounced' | 'immediate'; awaitCompletion?: boolean },
): void {
  const requires = FORCE_RESTART_CHANNELS.has(channelType)
    ? (options?.mode === 'immediate' ? 'restart_immediate' : 'restart')
    : 'reload';
  ctx.gatewayApplyCoordinator.enqueue({
    source: reason,
    reason,
    requires,
    delayMs: options?.mode === 'immediate' ? 0 : undefined,
    skipIfStopped: true,
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
  return ensureBundledPluginInstalled('channels', 'China Channels', { forceReinstall: true });
}

async function ensureFeishuPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  return ensureBundledPluginInstalled('feishu', 'Feishu / Lark', { forceReinstall: true });
}

async function ensureQQBotPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  return ensureBundledPluginInstalled('channels', 'China Channels', { forceReinstall: true });
}

async function ensureWeChatPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  const bundledResult = ensureBundledPluginInstalled('openclaw-weixin', 'WeChat', { forceReinstall: true });
  if (bundledResult.installed) {
    return bundledResult;
  }

  const pluginManifest = join(homedir(), '.openclaw', 'extensions', 'openclaw-weixin', 'openclaw.plugin.json');
  const cliAttempts = existsSync(pluginManifest)
    ? [
        ['plugins', 'update', 'openclaw-weixin'],
        ['plugins', 'install', WECHAT_PLUGIN_NPM_ONLY_SPEC],
      ]
    : [
        ['plugins', 'install', WECHAT_PLUGIN_NPM_ONLY_SPEC],
      ];

  try {
    let lastError: unknown;
    for (const cliArgs of cliAttempts) {
      try {
        await runOpenClawPluginCommand(cliArgs);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    if (existsSync(pluginManifest)) {
      repairManagedPluginSdkImports(join(homedir(), '.openclaw', 'extensions', 'openclaw-weixin'));
      return {
        installed: true,
        warning: bundledResult.warning,
      };
    }

    return {
      installed: false,
      warning: 'WeChat plugin install completed, but manifest was not found afterwards.',
    };
  } catch (error) {
    return {
      installed: false,
      warning: formatWeChatPluginInstallError(error instanceof Error ? error.message : String(error)),
    };
  }
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
    scheduleGatewayChannelRefresh(ctx, WECHAT_RUNTIME_CHANNEL_ID, `channel:saveConfig:${WECHAT_RUNTIME_CHANNEL_ID}`);

    if (!isActiveQrLogin(loginKey, sessionKey)) {
      return;
    }

    emitChannelEvent(ctx, WECHAT_UI_CHANNEL_ID, 'success', {
      accountId: normalizedAccountId,
      rawAccountId: result.accountId,
      message: result.message,
    });
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
      emitGatewayLifecycleEvent(ctx, {
        phase: 'failed',
        action: 'restart',
        source: 'channel:config',
        reason: 'channel:config',
        error: String(error),
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/channels/whatsapp/cancel' && req.method === 'POST') {
    try {
      await whatsAppLoginManager.stop();
      sendJson(res, 200, { success: true });
    } catch (error) {
      emitGatewayLifecycleEvent(ctx, {
        phase: 'failed',
        action: 'restart',
        source: 'channel:setEnabled',
        reason: 'channel:setEnabled',
        error: String(error),
      });
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
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      await saveChannelConfig(body.channelType, body.config);
      if (!body.skipRestart) {
        scheduleGatewayChannelRefresh(ctx, runtimeChannelType, `channel:saveConfig:${runtimeChannelType}`);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      emitGatewayLifecycleEvent(ctx, {
        phase: 'failed',
        action: 'restart',
        source: 'channel:delete',
        reason: 'channel:delete',
        error: String(error),
      });
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
        await clearChannelBinding(channelType, undefined, accountId).catch(() => undefined);
      } else {
        await clearAllChannelBindings(channelType).catch(() => undefined);
      }
      await ctx.gatewayApplyCoordinator.applyNow({
        source: `channel:deleteConfig:${channelType}`,
        reason: `channel:deleteConfig:${channelType}`,
        requires: FORCE_RESTART_CHANNELS.has(toRuntimeChannelType(channelType)) ? 'restart_immediate' : 'reload',
        skipIfStopped: true,
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
