import type { IncomingMessage, ServerResponse } from 'http';
import { app } from 'electron';
import { existsSync, cpSync, mkdirSync, rmSync } from 'node:fs';
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
import type { HostApiContext } from '../context';
import { emitGatewayLifecycleEvent } from '../gateway-lifecycle';
import { parseJsonBody, sendJson } from '../route-utils';

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
  const targetDir = join(homedir(), '.openclaw', 'extensions', 'dingtalk');
  const targetManifest = join(targetDir, 'openclaw.plugin.json');

  if (existsSync(targetManifest)) {
    return { installed: true };
  }

  const candidateSources = app.isPackaged
    ? [
      join(process.resourcesPath, 'openclaw-plugins', 'dingtalk'),
      join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', 'dingtalk'),
      join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', 'dingtalk'),
    ]
    : [
      join(app.getAppPath(), 'build', 'openclaw-plugins', 'dingtalk'),
      join(process.cwd(), 'build', 'openclaw-plugins', 'dingtalk'),
      join(__dirname, '../../../build/openclaw-plugins/dingtalk'),
    ];

  const sourceDir = candidateSources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json')));
  if (!sourceDir) {
    return {
      installed: false,
      warning: `Bundled DingTalk plugin mirror not found. Checked: ${candidateSources.join(' | ')}`,
    };
  }

  try {
    mkdirSync(join(homedir(), '.openclaw', 'extensions'), { recursive: true });
    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
    if (!existsSync(targetManifest)) {
      return { installed: false, warning: 'Failed to install DingTalk plugin mirror (manifest missing).' };
    }
    return { installed: true };
  } catch {
    return { installed: false, warning: 'Failed to install bundled DingTalk plugin mirror' };
  }
}

async function ensureWeComPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  const targetDir = join(homedir(), '.openclaw', 'extensions', 'wecom');
  const targetManifest = join(targetDir, 'openclaw.plugin.json');

  if (existsSync(targetManifest)) {
    return { installed: true };
  }

  const candidateSources = app.isPackaged
    ? [
        join(process.resourcesPath, 'openclaw-plugins', 'wecom'),
        join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', 'wecom'),
        join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', 'wecom'),
      ]
    : [
        join(app.getAppPath(), 'build', 'openclaw-plugins', 'wecom'),
        join(process.cwd(), 'build', 'openclaw-plugins', 'wecom'),
        join(__dirname, '../../../build/openclaw-plugins/wecom'),
      ];

  const sourceDir = candidateSources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json')));
  if (!sourceDir) {
    return {
      installed: false,
      warning: `Bundled WeCom plugin mirror not found. Checked: ${candidateSources.join(' | ')}`,
    };
  }

  try {
    mkdirSync(join(homedir(), '.openclaw', 'extensions'), { recursive: true });
    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
    if (!existsSync(targetManifest)) {
      return { installed: false, warning: 'Failed to install WeCom plugin mirror (manifest missing).' };
    }
    return { installed: true };
  } catch {
    return { installed: false, warning: 'Failed to install bundled WeCom plugin mirror' };
  }
}

async function ensureQQBotPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
  const targetDir = join(homedir(), '.openclaw', 'extensions', 'qqbot');
  const targetManifest = join(targetDir, 'openclaw.plugin.json');

  if (existsSync(targetManifest)) {
    return { installed: true };
  }

  const candidateSources = app.isPackaged
    ? [
        join(process.resourcesPath, 'openclaw-plugins', 'qqbot'),
        join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', 'qqbot'),
        join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', 'qqbot'),
      ]
    : [
        join(app.getAppPath(), 'build', 'openclaw-plugins', 'qqbot'),
        join(process.cwd(), 'build', 'openclaw-plugins', 'qqbot'),
        join(__dirname, '../../../build/openclaw-plugins/qqbot'),
      ];

  const sourceDir = candidateSources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json')));
  if (!sourceDir) {
    return {
      installed: false,
      warning: `Bundled QQ Bot plugin mirror not found. Checked: ${candidateSources.join(' | ')}`,
    };
  }

  try {
    mkdirSync(join(homedir(), '.openclaw', 'extensions'), { recursive: true });
    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
    if (!existsSync(targetManifest)) {
      return { installed: false, warning: 'Failed to install QQ Bot plugin mirror (manifest missing).' };
    }
    return { installed: true };
  } catch {
    return { installed: false, warning: 'Failed to install bundled QQ Bot plugin mirror' };
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

  if (url.pathname === '/api/channels/config' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ channelType: string; config: Record<string, unknown> }>(req);
      if (body.channelType === 'dingtalk') {
        const installResult = await ensureDingTalkPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'DingTalk plugin install failed' });
          return true;
        }
      }
      if (body.channelType === 'wecom') {
        const installResult = await ensureWeComPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'WeCom plugin install failed' });
          return true;
        }
      }
      if (body.channelType === 'qqbot') {
        const installResult = await ensureQQBotPluginInstalled();
        if (!installResult.installed) {
          sendJson(res, 500, { success: false, error: installResult.warning || 'QQ Bot plugin install failed' });
          return true;
        }
      }
      await saveChannelConfig(body.channelType, body.config);
      scheduleGatewayChannelRestart(ctx, `channel:saveConfig:${body.channelType}`);
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
