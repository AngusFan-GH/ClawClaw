import type { IncomingMessage, ServerResponse } from 'http';
import { PORTS } from '../../utils/config';
import { buildOpenClawControlUiUrl } from '../../utils/openclaw-control-ui';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getSetting } from '../../utils/store';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendBuffer, sendJson } from '../route-utils';

export async function handleGatewayRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const resolveGatewayStatus = async () => {
    const status = ctx.gatewayManager.getStatus();
    if (
      (status.state === 'stopped' || status.state === 'error') &&
      !ctx.gatewayManager.isConnected() &&
      !ctx.gatewayManager.isStartInProgress()
    ) {
      try {
        await ctx.gatewayManager.attachIfRunning();
      } catch {
        // Ignore attach probe failures and return the last known status.
      }
    }
    return ctx.gatewayManager.getStatus();
  };

  if (url.pathname === '/api/gateway/status' && req.method === 'GET') {
    sendJson(res, 200, await resolveGatewayStatus());
    return true;
  }

  if (url.pathname === '/api/gateway/health' && req.method === 'GET') {
    const health = await ctx.gatewayManager.checkHealth();
    sendJson(res, 200, health);
    return true;
  }

  if (url.pathname === '/api/gateway/start' && req.method === 'POST') {
    try {
      await ctx.gatewayManager.start();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/gateway/stop' && req.method === 'POST') {
    try {
      await ctx.gatewayManager.stop();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/gateway/restart' && req.method === 'POST') {
    try {
      const result = await ctx.gatewayApplyCoordinator.applyNow({
        source: 'gateway.manualRestart',
        reason: 'gateway.manualRestart',
        requires: 'restart_immediate',
        skipIfStopped: false,
      });
      sendJson(res, 200, { success: true, accepted: result.accepted });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/gateway/control-ui' && req.method === 'GET') {
    try {
      const status = await resolveGatewayStatus();
      const port = status.port || PORTS.OPENCLAW_GATEWAY;
      const token = await getSetting('gatewayToken');
      sendJson(res, 200, {
        success: true,
        url: buildOpenClawControlUiUrl(port, token),
        port,
        ready: status.state === 'running',
        state: status.state,
        error: status.error,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/chat/send-with-media' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        sessionKey: string;
        message: string;
        deliver?: boolean;
        idempotencyKey: string;
        media?: Array<{ filePath: string; mimeType: string; fileName: string }>;
      }>(req);
      const VISION_MIME_TYPES = new Set([
        'image/png', 'image/jpeg', 'image/bmp', 'image/webp',
      ]);
      const imageAttachments: Array<{ content: string; mimeType: string; fileName: string }> = [];
      const fileReferences: string[] = [];
      if (body.media && body.media.length > 0) {
        const fsP = await import('node:fs/promises');
        for (const m of body.media) {
          fileReferences.push(`[media attached: ${m.filePath} (${m.mimeType}) | ${m.filePath}]`);
          if (VISION_MIME_TYPES.has(m.mimeType)) {
            const fileBuffer = await fsP.readFile(m.filePath);
            imageAttachments.push({
              content: fileBuffer.toString('base64'),
              mimeType: m.mimeType,
              fileName: m.fileName,
            });
          }
        }
      }

      const message = fileReferences.length > 0
        ? [body.message, ...fileReferences].filter(Boolean).join('\n')
        : body.message;
      const rpcParams: Record<string, unknown> = {
        sessionKey: body.sessionKey,
        message,
        deliver: body.deliver ?? false,
        idempotencyKey: body.idempotencyKey,
      };
      if (imageAttachments.length > 0) {
        rpcParams.attachments = imageAttachments;
      }
      const result = await ctx.gatewayManager.rpc('chat.send', rpcParams, 120000);
      sendJson(res, 200, { success: true, result });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/chat/assistant-media' && req.method === 'GET') {
    try {
      const source = url.searchParams.get('source')?.trim();
      if (!source) {
        sendJson(res, 400, { success: false, error: 'Missing source parameter' });
        return true;
      }

      const status = await resolveGatewayStatus();
      const port = status.port || PORTS.OPENCLAW_GATEWAY;
      const token = await getSetting('gatewayToken');
      const upstream = new URL(`http://127.0.0.1:${port}/__openclaw__/assistant-media`);
      upstream.searchParams.set('source', source);
      if (url.searchParams.get('meta') === '1') {
        upstream.searchParams.set('meta', '1');
      }

      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await proxyAwareFetch(upstream, { method: 'GET', headers });
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const payload = await response.json().catch(() => null);
        sendJson(res, response.status, payload ?? { success: false, error: 'Invalid upstream JSON' });
        return true;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      sendBuffer(res, response.status, bytes, contentType || 'application/octet-stream');
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
