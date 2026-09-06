import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PORTS } from '../utils/config';
import { findAvailablePort } from '../utils/config';
import { logger } from '../utils/logger';
import type { HostApiContext } from './context';
import { handleAppRoutes } from './routes/app';
import { handleGatewayRoutes } from './routes/gateway';
import { handleSettingsRoutes } from './routes/settings';
import { handleProviderRoutes } from './routes/providers';
import { handleAgentRoutes } from './routes/agents';
import { handleChannelRoutes } from './routes/channels';
import { handleLogRoutes } from './routes/logs';
import { handleUsageRoutes } from './routes/usage';
import { handleSkillRoutes } from './routes/skills';
import { handleSecurityRoutes } from './routes/security';
import { handleRuntimeApplyRoutes } from './routes/runtime-apply';
import { handleFileRoutes } from './routes/files';
import { handleSessionRoutes } from './routes/sessions';
import { handleCronRoutes } from './routes/cron';
import { sendJson } from './route-utils';
import { hostApiToken } from '../host/auth';

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
) => Promise<boolean>;

const routeHandlers: RouteHandler[] = [
  handleAppRoutes,
  handleGatewayRoutes,
  handleSettingsRoutes,
  handleSecurityRoutes,
  handleRuntimeApplyRoutes,
  handleProviderRoutes,
  handleAgentRoutes,
  handleChannelRoutes,
  handleSkillRoutes,
  handleFileRoutes,
  handleSessionRoutes,
  handleCronRoutes,
  handleLogRoutes,
  handleUsageRoutes,
];

let currentHostApiPort: number = PORTS.CLAWX_HOST_API;

export function getHostApiPort(): number {
  return currentHostApiPort;
}

export async function startHostApiServer(
  ctx: HostApiContext,
  preferredPort = PORTS.CLAWX_HOST_API,
): Promise<Server> {
  const port = await findAvailablePort(preferredPort);
  currentHostApiPort = port;
  if (port !== preferredPort) {
    logger.warn(
      `Host API port ${preferredPort} is unavailable, using ${port} instead`,
    );
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${hostApiToken}`) {
        sendJson(res, 401, { error: 'Unauthorized host request' });
        return;
      }
      const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      for (const handler of routeHandlers) {
        if (await handler(req, res, requestUrl, ctx)) {
          return;
        }
      }
      sendJson(res, 404, { success: false, error: `No route for ${req.method} ${requestUrl.pathname}` });
    } catch (error) {
      logger.error('Host API request failed:', error);
      sendJson(res, 500, { success: false, error: String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    const handleListening = () => {
      server.off('error', handleError);
      logger.info(`Host API server listening on http://127.0.0.1:${port}`);
      resolve();
    };
    const handleError = (error: Error) => {
      server.off('listening', handleListening);
      reject(error);
    };

    server.once('listening', handleListening);
    server.once('error', handleError);
    server.listen(port, '127.0.0.1');
  });

  return server;
}
