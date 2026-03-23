import type { IncomingMessage, ServerResponse } from 'http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  deleteChannelConfig,
  getChannelFormValues,
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
import { emitGatewayLifecycleEvent } from '../gateway-lifecycle';
import { parseJsonBody, sendJson } from '../route-utils';
import { ensureBundledPluginInstalled } from '../../utils/bundled-plugin-installer';
import { getOpenClawCliSpawnConfig } from '../../utils/openclaw-cli';
import { clearChannelBinding } from '../../utils/agent-config';

const WECHAT_QR_TIMEOUT_MS = 8 * 60 * 1000;
const activeQrLogins = new Map<string, string>();
const WECHAT_PLUGIN_SPEC = '@tencent-weixin/openclaw-weixin';

function scheduleGatewayChannelRestart(ctx: HostApiContext, reason: string): void {
  if (ctx.gatewayManager.getStatus().state === 'stopped') {
    return;
  }
  emitGatewayLifecycleEvent(ctx, {
    phase: 'scheduled',
    action: 'restart',
    source: reason,
    reason,
    delayMs: 2000,
  });
  ctx.gatewayManager.debouncedRestart();
}

async function ensureDingTalkPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  return ensureBundledPluginInstalled('dingtalk', 'DingTalk');
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
    scheduleGatewayChannelRestart(ctx, `channel:saveConfig:${WECHAT_RUNTIME_CHANNEL_ID}`);

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
  if (url.pathname === '/api/channels/configured' && req.method === 'GET') {
    const groups = await listConfiguredChannelGroups();
    sendJson(res, 200, {
      success: true,
      channels: groups.map((group) => group.type),
      accountsByType: Object.fromEntries(
        groups
          .filter((group) => group.accounts.length > 0)
          .map((group) => [group.type, group.accounts.map((account) => account.accountId)]),
      ),
      groups,
    });
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
        scheduleGatewayChannelRestart(ctx, `channel:saveConfig:${runtimeChannelType}`);
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
      scheduleGatewayChannelRestart(ctx, `channel:setEnabled:${body.channelType}`);
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
      await clearChannelBinding(channelType, undefined, accountId || undefined).catch(() => undefined);
      scheduleGatewayChannelRestart(ctx, `channel:deleteConfig:${channelType}`);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  void ctx;
  return false;
}
