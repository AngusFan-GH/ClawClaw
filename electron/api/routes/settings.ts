import type { IncomingMessage, ServerResponse } from 'http';
import { applyProxySettings } from '../../main/proxy';
import { getAllSettings, getSetting, resetSettings, setSetting, type AppSettings } from '../../utils/store';
import type { HostApiContext } from '../context';
import { emitGatewayLifecycleEvent } from '../gateway-lifecycle';
import { parseJsonBody, sendJson } from '../route-utils';

async function handleProxySettingsChange(ctx: HostApiContext): Promise<void> {
  const settings = await getAllSettings();
  await applyProxySettings(settings);
  if (ctx.gatewayManager.getStatus().state === 'running') {
    emitGatewayLifecycleEvent(ctx, {
      phase: 'scheduled',
      action: 'restart',
      source: 'settings.proxy',
      reason: 'settings.proxy',
    });
    await ctx.gatewayManager.restart();
  }
}

function patchTouchesProxy(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => (
    key === 'proxyMode' ||
    key === 'proxyEnabled' ||
    key === 'proxyServer' ||
    key === 'proxyHttpServer' ||
    key === 'proxyHttpsServer' ||
    key === 'proxyAllServer' ||
    key === 'proxyBypassRules'
  ));
}

export async function handleSettingsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/settings' && req.method === 'GET') {
    sendJson(res, 200, await getAllSettings());
    return true;
  }

  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    let patch: Partial<AppSettings> = {};
    try {
      patch = await parseJsonBody<Partial<AppSettings>>(req);
      const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
      for (const [key, value] of entries) {
        await setSetting(key, value);
      }
      if (patchTouchesProxy(patch)) {
        await handleProxySettingsChange(ctx);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      if (patchTouchesProxy(patch)) {
        emitGatewayLifecycleEvent(ctx, {
          phase: 'failed',
          action: 'restart',
          source: 'settings.proxy',
          reason: 'settings.proxy',
          error: String(error),
        });
      }
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'GET') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      sendJson(res, 200, { value: await getSetting(key) });
    } catch (error) {
      sendJson(res, 404, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'PUT') {
    const key = url.pathname.slice('/api/settings/'.length) as keyof AppSettings;
    try {
      const body = await parseJsonBody<{ value: AppSettings[keyof AppSettings] }>(req);
      await setSetting(key, body.value);
      if (
        key === 'proxyEnabled' ||
        key === 'proxyMode' ||
        key === 'proxyServer' ||
        key === 'proxyHttpServer' ||
        key === 'proxyHttpsServer' ||
        key === 'proxyAllServer' ||
        key === 'proxyBypassRules'
      ) {
        await handleProxySettingsChange(ctx);
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      if (
        key === 'proxyEnabled' ||
        key === 'proxyMode' ||
        key === 'proxyServer' ||
        key === 'proxyHttpServer' ||
        key === 'proxyHttpsServer' ||
        key === 'proxyAllServer' ||
        key === 'proxyBypassRules'
      ) {
        emitGatewayLifecycleEvent(ctx, {
          phase: 'failed',
          action: 'restart',
          source: 'settings.proxy',
          reason: 'settings.proxy',
          error: String(error),
        });
      }
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/settings/reset' && req.method === 'POST') {
    try {
      await resetSettings();
      await handleProxySettingsChange(ctx);
      sendJson(res, 200, { success: true, settings: await getAllSettings() });
    } catch (error) {
      emitGatewayLifecycleEvent(ctx, {
        phase: 'failed',
        action: 'restart',
        source: 'settings.proxy',
        reason: 'settings.proxy',
        error: String(error),
      });
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
