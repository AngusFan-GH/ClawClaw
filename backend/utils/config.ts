/**
 * Application Configuration
 * Centralized configuration constants and helpers
 */

import { createServer } from 'node:net';

/**
 * Port configuration
 */
export const PORTS = {
  /** ClawClaw GUI development server port */
  CLAWX_DEV: 5173,

  /** ClawClaw GUI production port (for reference) */
  CLAWX_GUI: 23333,

  /** Local host API server port */
  CLAWX_HOST_API: 3210,

  /** OpenClaw Gateway port */
  OPENCLAW_GATEWAY: 18789,

  /** First fallback port reserved for ClawClaw-managed Gateway instances */
  CLAWX_MANAGED_GATEWAY_START: 18820,
} as const;

const MAX_PORT = 18899;

/**
 * Check if a TCP port is available (not in use)
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find the first available port starting from startPort (inclusive).
 * Scans up to MAX_PORT.
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port <= MAX_PORT; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found between ${startPort} and ${MAX_PORT}`);
}

/**
 * Get port from environment or default
 */
export function getPort(key: keyof typeof PORTS): number {
  const envKey = `CLAWX_PORT_${key}`;
  const envValue = process.env[envKey];
  return envValue ? parseInt(envValue, 10) : PORTS[key];
}

/**
 * Application paths
 */
export const APP_PATHS = {
  /** OpenClaw configuration directory */
  OPENCLAW_CONFIG: '~/.openclaw',

  /** ClawClaw configuration directory */
  CLAWX_CONFIG: '~/.clawclaw',

  /** Log files directory */
  LOGS: '~/.clawclaw/logs',
} as const;

/**
 * Update channels
 */
export const UPDATE_CHANNELS = ['stable'] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/**
 * Default update configuration
 */
export const UPDATE_CONFIG = {
  /** Check interval in milliseconds (6 hours) */
  CHECK_INTERVAL: 6 * 60 * 60 * 1000,

  /** Default update channel */
  DEFAULT_CHANNEL: 'stable' as UpdateChannel,

  /** Auto download updates */
  AUTO_DOWNLOAD: false,

  /** Show update notifications */
  SHOW_NOTIFICATION: true,
};

/**
 * Gateway configuration
 */
export const GATEWAY_CONFIG = {
  /** WebSocket reconnection delay (ms) */
  RECONNECT_DELAY: 5000,

  /** RPC call timeout (ms) */
  RPC_TIMEOUT: 30000,

  /** Health check interval (ms) */
  HEALTH_CHECK_INTERVAL: 30000,

  /** Maximum startup retries */
  MAX_STARTUP_RETRIES: 30,

  /** Startup retry interval (ms) */
  STARTUP_RETRY_INTERVAL: 1000,
};
