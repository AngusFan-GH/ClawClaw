import type { IncomingMessage, ServerResponse } from 'http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
import { runGatewayRefresh } from '../gateway-refresh';
import { parseJsonBody, sendJson } from '../route-utils';
import { ensureBundledPluginInstalled } from '../../utils/bundled-plugin-installer';
import { getOpenClawCliSpawnConfig } from '../../utils/openclaw-cli';
import { clearAllChannelBindings, clearChannelBinding } from '../../utils/agent-config';
import type { ChannelType } from '../../../src/types/channel';

const WECHAT_QR_TIMEOUT_MS = 8 * 60 * 1000;
const activeQrLogins = new Map<string, string>();
const WECHAT_PLUGIN_SPEC = '@tencent-weixin/openclaw-weixin';
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

function mapAccountStatus(account: {
  connected?: boolean;
  linked?: boolean;
  running?: boolean;
  lastError?: string;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastConnectedAt?: number | null;
}): ChannelAccountView['status'] {
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
  return Boolean(account.configured) || status === 'connected' || status === 'connecting';
}

function resolveGroupStatus(group: ChannelGroupView): ChannelGroupView['status'] {
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
      const summary = (runtimeSnapshot.channels as Record<string, unknown> | undefined)?.[rawChannelId] as Record<string, unknown> | undefined;
      const summaryError =
        typeof (summary as { error?: string })?.error === 'string'
          ? (summary as { error?: string }).error
          : typeof (summary as { lastError?: string })?.lastError === 'string'
            ? (summary as { lastError?: string }).lastError
            : undefined;
      const defaultAccountId = runtimeSnapshot.channelDefaultAccountId?.[rawChannelId];
      const runtimeAccounts = runtimeSnapshot.channelAccounts?.[rawChannelId] || [];
      const existing = groups.get(type) || {
        type,
        name: type,
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
        if (!shouldKeepRuntimeAccount(runtimeAccount)) continue;
        const accountId = runtimeAccount.accountId || 'default';
        const status = mapAccountStatus(runtimeAccount);
        const prior = accountMap.get(accountId);
        accountMap.set(accountId, {
          id: `${type}:${accountId}`,
          type,
          name: runtimeAccount.name || prior?.name || type,
          status,
          configured: runtimeAccount.configured ?? prior?.configured ?? true,
          runtimeLoaded: true,
          runtimeStatus: status,
          accountId,
          isDefaultAccount: accountId === (defaultAccountId || existing.defaultAccountId || 'default'),
          error: runtimeAccount.lastError || summaryError || prior?.error,
          metadata: {
            ...prior?.metadata,
            isDefaultAccount: accountId === (defaultAccountId || existing.defaultAccountId || 'default'),
          },
        });
      }

      const nextGroup: ChannelGroupView = {
        ...existing,
        configured: existing.configured || runtimeAccounts.some((account) => account.configured === true),
        runtimeLoaded: true,
        pluginLoaded: true,
        defaultAccountId: defaultAccountId || existing.defaultAccountId,
        configuredAccounts: Array.from(new Set([
          ...existing.configuredAccounts,
          ...runtimeAccounts
            .filter((account) => account.configured === true)
            .map((account) => account.accountId || 'default'),
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

function scheduleGatewayChannelRefresh(ctx: HostApiContext, channelType: string, reason: string): void {
  const action = FORCE_RESTART_CHANNELS.has(channelType) ? 'restart' : 'reload';
  void runGatewayRefresh(ctx, {
    action,
    source: reason,
    reason,
    delayMs: action === 'restart' ? 2000 : 1200,
    mode: 'debounced',
    awaitCompletion: false,
  });
}

async function ensureDingTalkPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  return ensureBundledPluginInstalled('dingtalk', 'DingTalk');
}

async function ensureFeishuPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  return ensureBundledPluginInstalled('openclaw-lark', 'Feishu / Lark');
}

async function ensureWeComPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  return ensureBundledPluginInstalled('wecom', 'WeCom');
}

async function ensureQQBotPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  return ensureBundledPluginInstalled('qqbot', 'QQ Bot');
}

async function ensureWeChatPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  const bundledResult = ensureBundledPluginInstalled('openclaw-weixin', 'WeChat');
  if (bundledResult.installed) {
    return bundledResult;
  }

  const pluginManifest = join(homedir(), '.openclaw', 'extensions', 'openclaw-weixin', 'openclaw.plugin.json');
  const cliArgs = existsSync(pluginManifest)
    ? ['plugins', 'update', 'openclaw-weixin']
    : ['plugins', 'install', WECHAT_PLUGIN_SPEC];
  const spawnConfig = getOpenClawCliSpawnConfig(cliArgs);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(spawnConfig.command, spawnConfig.args, {
        cwd: spawnConfig.cwd,
        env: spawnConfig.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
      });

      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(
          stderr.trim()
            || `WeChat plugin install failed with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`,
        ));
      });
    });

    if (existsSync(pluginManifest)) {
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
      warning: error instanceof Error ? error.message : String(error),
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
      if (runtimeChannelType === 'wecom') {
        const installResult = await ensureWeComPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'WeCom plugin install failed' });
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
      scheduleGatewayChannelRefresh(ctx, toRuntimeChannelType(channelType), `channel:deleteConfig:${channelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  void ctx;
  return false;
}
