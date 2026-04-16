import WebSocket from 'ws';
import type { DeviceIdentity } from '../utils/device-identity';
import {
  buildDeviceAuthPayload,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from '../utils/device-identity';
import {
  clearDeviceAuthToken,
  loadDeviceAuthToken,
  storeDeviceAuthToken,
} from '../utils/device-auth-store';
import { logger } from '../utils/logger';

const BACKEND_GATEWAY_CLIENT_ID = 'gateway-client';
const BACKEND_GATEWAY_CLIENT_MODE = 'backend';
const OPERATOR_SCOPE_BUNDLE = [
  'operator.admin',
  'operator.read',
  'operator.write',
  'operator.approvals',
  'operator.pairing',
] as const;
const GATEWAY_CLIENT_CAPS = ['tool-events'] as const;
const CONNECT_ERROR_CODES = {
  AUTH_TOKEN_MISMATCH: 'AUTH_TOKEN_MISMATCH',
  AUTH_DEVICE_TOKEN_MISMATCH: 'AUTH_DEVICE_TOKEN_MISMATCH',
} as const;
const DEFAULT_GATEWAY_HANDSHAKE_TIMEOUT_MS = 20_000;

type GatewayHelloOk = {
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
  };
};

type GatewayErrorDetails = {
  code?: unknown;
  canRetryWithDeviceToken?: unknown;
  recommendedNextStep?: unknown;
};

type GatewayResponseFrame = {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

function resolveGatewayHandshakeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OPENCLAW_HANDSHAKE_TIMEOUT_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_GATEWAY_HANDSHAKE_TIMEOUT_MS;
}

function resolveConnectErrorDetailCode(details: unknown): string | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }
  const code = (details as GatewayErrorDetails).code;
  return typeof code === 'string' && code.trim().length > 0 ? code : null;
}

function canRetryWithDeviceToken(details: unknown): boolean {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return false;
  }
  const parsed = details as GatewayErrorDetails;
  return (
    parsed.canRetryWithDeviceToken === true ||
    parsed.recommendedNextStep === 'retry_with_device_token'
  );
}

/**
 * Fast TCP check — returns immediately if the port is not listening.
 * This avoids the cost of spinning up a full WebSocket client when the
 * Gateway process hasn't even opened its port yet.
 */
async function isPortListening(port: number): Promise<boolean> {
  const net = await import('node:net');
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Probe whether the OpenClaw Gateway is ready to accept connections.
 *
 * OpenClaw sends `connect.challenge` immediately on WebSocket connection
 * (see openclaw/src/gateway/server/ws-connection.ts:247-249), so a 300ms
 * timeout is plenty. We first do a cheap TCP check to avoid the WS
 * handshake overhead when the port isn't even open yet.
 *
 * @param port  Gateway port
 * @param timeoutMs  Max time to wait for connect.challenge (default 300ms)
 */
export async function probeGatewayReady(port: number, timeoutMs = 300): Promise<boolean> {
  // Fast path: if the port isn't open yet, don't bother spinning up a WebSocket.
  if (!(await isPortListening(port))) {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    const testWs = new WebSocket(`ws://localhost:${port}/ws`);
    let settled = false;

    const resolveOnce = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try {
        testWs.close();
      } catch {
        // ignore
      }
      resolve(value);
    };

    const timeoutId = setTimeout(() => {
      resolveOnce(false);
    }, timeoutMs);

    testWs.on('open', () => {
      // Do not resolve on plain socket open. The gateway can accept the TCP/WebSocket
      // connection before it is ready to issue protocol challenges, which previously
      // caused a false "ready" result and then a full connect() stall.
    });

    testWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as { type?: string; event?: string };
        if (message.type === 'event' && message.event === 'connect.challenge') {
          resolveOnce(true);
        }
      } catch {
        // ignore malformed probe payloads
      }
    });

    testWs.on('error', () => {
      resolveOnce(false);
    });

    testWs.on('close', () => {
      resolveOnce(false);
    });
  });
}

export async function waitForGatewayReady(options: {
  port: number;
  getProcessExitCode: () => number | string | null;
  retries?: number;
  intervalMs?: number;
}): Promise<void> {
  const retries = options.retries ?? 2400;
  const intervalMs = options.intervalMs ?? 200;

  for (let i = 0; i < retries; i++) {
    const exitCode = options.getProcessExitCode();
    if (exitCode !== null) {
      logger.error(`Gateway process exited before ready (status=${exitCode})`);
      throw new Error(`Gateway process exited before becoming ready (status=${exitCode})`);
    }

    try {
      const ready = await probeGatewayReady(options.port);
      if (ready) {
        logger.debug(`Gateway ready after ${i + 1} attempt(s)`);
        return;
      }
    } catch {
      // Gateway not ready yet.
    }

    if (i > 0 && i % 10 === 0) {
      logger.debug(`Still waiting for Gateway... (attempt ${i + 1}/${retries})`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  logger.error(`Gateway failed to become ready after ${retries} attempts on port ${options.port}`);
  throw new Error(`Gateway failed to start after ${retries} retries (port ${options.port})`);
}

export function buildGatewayConnectFrame(options: {
  challengeNonce: string;
  token: string;
  deviceToken?: string;
  deviceIdentity: DeviceIdentity | null;
  platform: string;
  clientVersion?: string;
}): { connectId: string; frame: Record<string, unknown> } {
  const connectId = `connect-${Date.now()}`;
  const role = 'operator';
  const scopes = [...OPERATOR_SCOPE_BUNDLE];
  const signedAtMs = Date.now();
  const clientId = BACKEND_GATEWAY_CLIENT_ID;
  const clientMode = BACKEND_GATEWAY_CLIENT_MODE;

  const device = (() => {
    if (!options.deviceIdentity) return undefined;

    const payload = buildDeviceAuthPayload({
      deviceId: options.deviceIdentity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: options.token ?? null,
      nonce: options.challengeNonce,
    });
    const signature = signDevicePayload(options.deviceIdentity.privateKeyPem, payload);
    return {
      id: options.deviceIdentity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(options.deviceIdentity.publicKeyPem),
      signature,
      signedAt: signedAtMs,
      nonce: options.challengeNonce,
    };
  })();

  return {
    connectId,
    frame: {
      type: 'req',
      id: connectId,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: clientId,
          displayName: 'ClawClaw',
          version: options.clientVersion || '0.1.12',
          platform: options.platform,
          mode: clientMode,
        },
        auth: {
          token: options.token,
          ...(options.deviceToken ? { deviceToken: options.deviceToken } : {}),
        },
        caps: [...GATEWAY_CLIENT_CAPS],
        role,
        scopes,
        device,
      },
    },
  };
}

export async function connectGatewaySocket(options: {
  port: number;
  deviceIdentity: DeviceIdentity | null;
  platform: string;
  getToken: () => Promise<string>;
  onHandshakeComplete: (ws: WebSocket) => void;
  onMessage: (message: unknown) => void;
  onCloseAfterHandshake: () => void;
}): Promise<WebSocket> {
  logger.debug(`Connecting Gateway WebSocket (ws://localhost:${options.port}/ws)`);

  return await new Promise<WebSocket>((resolve, reject) => {
    const wsUrl = `ws://localhost:${options.port}/ws`;
    const ws = new WebSocket(wsUrl);
    const handshakeTimeoutMs = resolveGatewayHandshakeTimeoutMs();
    let handshakeComplete = false;
    let connectId: string | null = null;
    let handshakeTimeout: NodeJS.Timeout | null = null;
    let challengeTimer: NodeJS.Timeout | null = null;
    let challengeReceived = false;
    let settled = false;
    let deviceTokenRetryUsed = false;
    let currentChallengeNonce: string | null = null;

    const cleanupHandshakeRequest = () => {
      if (challengeTimer) {
        clearTimeout(challengeTimer);
        challengeTimer = null;
      }
      if (handshakeTimeout) {
        clearTimeout(handshakeTimeout);
        handshakeTimeout = null;
      }
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanupHandshakeRequest();
      resolve(ws);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanupHandshakeRequest();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const sendConnectHandshake = async (challengeNonce: string, retryWithDeviceToken = false) => {
      logger.debug('Sending connect handshake with challenge nonce');

      const currentToken = await options.getToken();
      const storedDeviceToken =
        retryWithDeviceToken && options.deviceIdentity
          ? await loadDeviceAuthToken({
              deviceId: options.deviceIdentity.deviceId,
              role: 'operator',
            })
          : null;
      if (retryWithDeviceToken && !storedDeviceToken?.token) {
        throw new Error('No stored device token available for Gateway reconnect retry');
      }
      const connectPayload = buildGatewayConnectFrame({
        challengeNonce,
        token: currentToken,
        deviceToken: storedDeviceToken?.token,
        deviceIdentity: options.deviceIdentity,
        platform: options.platform,
      });
      connectId = connectPayload.connectId;

      ws.send(JSON.stringify(connectPayload.frame));
      if (handshakeTimeout) {
        clearTimeout(handshakeTimeout);
      }
      handshakeTimeout = setTimeout(() => {
        if (!handshakeComplete) {
          logger.error('Gateway connect handshake timed out');
          ws.close();
          rejectOnce(new Error('Connect handshake timeout'));
        }
      }, handshakeTimeoutMs);
    };

    challengeTimer = setTimeout(() => {
      if (!challengeReceived && !settled) {
        logger.error('Gateway connect.challenge not received within timeout');
        ws.close();
        rejectOnce(new Error('Timed out waiting for connect.challenge from Gateway'));
      }
    }, handshakeTimeoutMs);

    ws.on('open', () => {
      logger.debug('Gateway WebSocket opened, waiting for connect.challenge...');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (
          !challengeReceived &&
          typeof message === 'object' &&
          message !== null &&
          message.type === 'event' &&
          message.event === 'connect.challenge'
        ) {
          challengeReceived = true;
          if (challengeTimer) {
            clearTimeout(challengeTimer);
            challengeTimer = null;
          }
          const nonce = message.payload?.nonce as string | undefined;
          if (!nonce) {
            rejectOnce(new Error('Gateway connect.challenge missing nonce'));
            return;
          }
          currentChallengeNonce = nonce;
          logger.debug('Received connect.challenge, sending handshake');
          void sendConnectHandshake(nonce);
          return;
        }

        if (
          !handshakeComplete &&
          connectId &&
          typeof message === 'object' &&
          message !== null &&
          message.type === 'res' &&
          message.id === connectId
        ) {
          const response = message as GatewayResponseFrame;
          if (response.ok) {
            handshakeComplete = true;
            const hello = (response.payload ?? {}) as GatewayHelloOk;
            if (options.deviceIdentity && hello.auth?.deviceToken) {
              void storeDeviceAuthToken({
                deviceId: options.deviceIdentity.deviceId,
                role: hello.auth.role || 'operator',
                token: hello.auth.deviceToken,
                scopes: hello.auth.scopes,
              }).catch((error) => {
                logger.debug(`Failed to persist Gateway device token: ${String(error)}`);
              });
            }
            logger.debug('Gateway connect handshake completed');
            options.onHandshakeComplete(ws);
            resolveOnce();
            return;
          }

          const detailCode = resolveConnectErrorDetailCode(response.error?.details);
          const retryAllowedByServer = canRetryWithDeviceToken(response.error?.details);
          const hasDeviceIdentity = Boolean(options.deviceIdentity?.deviceId);
          const shouldRetry =
            !deviceTokenRetryUsed &&
            hasDeviceIdentity &&
            (detailCode === CONNECT_ERROR_CODES.AUTH_TOKEN_MISMATCH || retryAllowedByServer);

          if (shouldRetry) {
            deviceTokenRetryUsed = true;
            logger.info('Gateway connect failed with token mismatch; retrying once with stored device token');
            if (!currentChallengeNonce) {
              rejectOnce(new Error(response.error?.message || 'Connect handshake failed'));
              return;
            }
            void sendConnectHandshake(currentChallengeNonce, true).catch((error) => {
              rejectOnce(error);
            });
            return;
          }

          if (
            detailCode === CONNECT_ERROR_CODES.AUTH_DEVICE_TOKEN_MISMATCH &&
            options.deviceIdentity
          ) {
            void clearDeviceAuthToken({
              deviceId: options.deviceIdentity.deviceId,
              role: 'operator',
            }).catch((error) => {
              logger.debug(`Failed to clear stale Gateway device token: ${String(error)}`);
            });
          }

          logger.error('Gateway connect handshake failed:', response.error?.message || 'request failed');
          rejectOnce(new Error(response.error?.message || 'Connect handshake failed'));
          return;
        }

        options.onMessage(message);
      } catch (error) {
        logger.debug('Failed to parse Gateway WebSocket message:', error);
      }
    });

    ws.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || 'unknown';
      logger.warn(
        `Gateway WebSocket closed (code=${code}, reason=${reasonStr}, handshake=${handshakeComplete ? 'ok' : 'pending'})`
      );
      if (!handshakeComplete) {
        rejectOnce(new Error(`WebSocket closed before handshake: ${reasonStr}`));
        return;
      }
      cleanupHandshakeRequest();
      options.onCloseAfterHandshake();
    });

    ws.on('error', (error) => {
      if (
        error.message?.includes('closed before handshake') ||
        (error as NodeJS.ErrnoException).code === 'ECONNREFUSED'
      ) {
        logger.debug(`Gateway WebSocket connection error (transient): ${error.message}`);
      } else {
        logger.error('Gateway WebSocket error:', error);
      }
      if (!handshakeComplete) {
        rejectOnce(error);
      }
    });
  });
}
