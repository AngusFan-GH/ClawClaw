import WebSocket from 'ws';
import http from 'node:http';
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
const GATEWAY_PROTOCOL_VERSION = 4;
const CONNECT_ERROR_CODES = {
  AUTH_TOKEN_MISMATCH: 'AUTH_TOKEN_MISMATCH',
  AUTH_DEVICE_TOKEN_MISMATCH: 'AUTH_DEVICE_TOKEN_MISMATCH',
} as const;
const DEFAULT_GATEWAY_HANDSHAKE_TIMEOUT_MS = 20_000;
const DEFAULT_GATEWAY_READY_TIMEOUT_MS = 60_000;
const DEFAULT_GATEWAY_READY_TIMEOUT_WINDOWS_MS = 120_000;
const DEFAULT_GATEWAY_READY_INTERVAL_MS = 200;
const GATEWAY_LOOPBACK_HOST = '127.0.0.1';
const GATEWAY_READY_LOG_MILESTONES_MS = [5_000, 15_000, 30_000, 45_000, 60_000, 90_000] as const;
// Give /readyz a slightly wider startup budget so event-loop pressure from
// channel/plugin warmup doesn't look like a hard not-ready condition.
const GATEWAY_READY_PROBE_TIMEOUT_MS = 2_500;
const GATEWAY_READY_DIAGNOSTIC_BODY_LIMIT = 240;

function formatGatewayReadyTimeout(timeoutMs: number): string {
  if (timeoutMs < 1000) return `${timeoutMs}ms`;
  return `${Math.round(timeoutMs / 1000)}s`;
}

function resolveGatewayReadyTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): number {
  const raw = env.OPENCLAW_READY_TIMEOUT_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return platform === 'win32'
    ? DEFAULT_GATEWAY_READY_TIMEOUT_WINDOWS_MS
    : DEFAULT_GATEWAY_READY_TIMEOUT_MS;
}

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

type GatewayReadyProbeResult = {
  ready: boolean;
  statusCode?: number;
  detail?: string;
  failing?: string[];
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

function formatGatewayReadyProbeDetail(result: GatewayReadyProbeResult | null): string {
  if (!result) return 'no /readyz response';
  const parts: string[] = [];
  if (typeof result.statusCode === 'number') {
    parts.push(`HTTP ${result.statusCode}`);
  }
  if (result.detail) {
    parts.push(result.detail);
  }
  return parts.length > 0 ? parts.join(': ') : 'not ready';
}

async function requestGatewayReadyz(port: number): Promise<GatewayReadyProbeResult> {
  return await new Promise<GatewayReadyProbeResult>((resolve) => {
    let settled = false;
    const resolveOnce = (value: GatewayReadyProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = http.request(
      {
        method: 'GET',
        host: GATEWAY_LOOPBACK_HOST,
        port,
        path: '/readyz',
        timeout: GATEWAY_READY_PROBE_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => {
          if (Buffer.concat(chunks).length >= GATEWAY_READY_DIAGNOSTIC_BODY_LIMIT) {
            return;
          }
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          const statusCode = res.statusCode;
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const body = rawBody.replace(/\s+/g, ' ').trim().slice(0, GATEWAY_READY_DIAGNOSTIC_BODY_LIMIT);
          let failing: string[] | undefined;
          try {
            const parsed = JSON.parse(rawBody) as { failing?: unknown };
            if (Array.isArray(parsed.failing)) {
              failing = parsed.failing.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
            }
          } catch {
            // Non-JSON diagnostics are still useful in detail.
          }
          resolveOnce({
            ready: statusCode != null && statusCode >= 200 && statusCode < 300,
            statusCode,
            ...(body ? { detail: body } : {}),
            ...(failing && failing.length > 0 ? { failing } : {}),
          });
        });
      },
    );

    req.once('error', (error) => resolveOnce({ ready: false, detail: error.message }));
    req.once('timeout', () => {
      try {
        req.destroy();
      } catch {
        // ignore
      }
      resolveOnce({ ready: false, detail: `probe timed out after ${GATEWAY_READY_PROBE_TIMEOUT_MS}ms` });
    });
    req.end();
  });
}

/**
 * Probe whether the OpenClaw Gateway is ready to accept connections.
 *
 * OpenClaw exposes `/readyz` once the HTTP server is bound and reports 2xx only
 * when the Gateway's startup sidecars have settled. This is more accurate than
 * a bare TCP check, which can pass while the Gateway is still not usable.
 *
 * @param port  Gateway port
 */
export async function probeGatewayReady(port: number): Promise<boolean> {
  const result = await requestGatewayReadyz(port);
  return result.ready;
}

export async function waitForGatewayReady(options: {
  port: number;
  getProcessExitCode: () => number | string | null;
  probeReady?: (port: number) => Promise<boolean>;
  toleratedFailingChannels?: string[];
  timeoutMs?: number;
  retries?: number;
  intervalMs?: number;
}): Promise<void> {
  const intervalMs = options.intervalMs ?? DEFAULT_GATEWAY_READY_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? (
    options.retries != null
      ? options.retries * intervalMs
      : resolveGatewayReadyTimeoutMs()
  );
  const startedAt = Date.now();
  const milestones = GATEWAY_READY_LOG_MILESTONES_MS.filter((ms) => ms < timeoutMs);
  let nextMilestoneIndex = 0;
  let attempts = 0;
  let lastProbeResult: GatewayReadyProbeResult | null = null;

  while (true) {
    attempts++;
    const exitCode = options.getProcessExitCode();
    if (exitCode !== null) {
      logger.error(`Gateway process exited before ready (status=${exitCode})`);
      throw new Error(`Gateway process exited before becoming ready (status=${exitCode})`);
    }

    if (Date.now() - startedAt >= timeoutMs) {
      break;
    }

    let ready = false;
    try {
      if (options.probeReady) {
        ready = await options.probeReady(options.port);
        lastProbeResult = { ready };
      } else {
        lastProbeResult = await requestGatewayReadyz(options.port);
        ready = lastProbeResult.ready;
      }
    } catch {
      // Gateway not ready yet.
    }

    if (!ready && lastProbeResult?.statusCode === 503 && lastProbeResult.failing?.length) {
      const toleratedFailures = new Set(options.toleratedFailingChannels ?? []);
      const onlyToleratedFailures = lastProbeResult.failing.every((channel) => toleratedFailures.has(channel));
      if (onlyToleratedFailures) {
        logger.warn(
          `Gateway /readyz reported only deferred channel failures (${lastProbeResult.failing.join(', ')}); continuing startup`,
        );
        ready = true;
      }
    }

    if (ready) {
      logger.debug(`Gateway ready after ${attempts} attempt(s) in ${Date.now() - startedAt}ms`);
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    while (
      nextMilestoneIndex < milestones.length &&
      elapsedMs >= milestones[nextMilestoneIndex]
    ) {
      logger.debug(
        `Still waiting for Gateway ${options.port} readiness... (${Math.round(elapsedMs / 1000)}s elapsed; ${formatGatewayReadyProbeDetail(lastProbeResult)})`,
      );
      nextMilestoneIndex++;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  logger.error(
    `Gateway failed to become ready on port ${options.port} within ${timeoutMs}ms (${attempts} probe attempts; ${formatGatewayReadyProbeDetail(lastProbeResult)})`,
  );
  throw new Error(
    `Gateway did not become ready on port ${options.port} within ${formatGatewayReadyTimeout(timeoutMs)} (${formatGatewayReadyProbeDetail(lastProbeResult)})`,
  );
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
        minProtocol: GATEWAY_PROTOCOL_VERSION,
        maxProtocol: GATEWAY_PROTOCOL_VERSION,
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
  handshakeTimeoutMs?: number;
  onHandshakeComplete: (ws: WebSocket) => void;
  onMessage: (message: unknown) => void;
  onCloseAfterHandshake: () => void;
}): Promise<WebSocket> {
  logger.debug(`Connecting Gateway WebSocket (ws://${GATEWAY_LOOPBACK_HOST}:${options.port}/ws)`);

  return await new Promise<WebSocket>((resolve, reject) => {
    const wsUrl = `ws://${GATEWAY_LOOPBACK_HOST}:${options.port}/ws`;
    const ws = new WebSocket(wsUrl);
    const handshakeTimeoutMs =
      typeof options.handshakeTimeoutMs === 'number' && Number.isFinite(options.handshakeTimeoutMs)
        ? Math.max(Math.floor(options.handshakeTimeoutMs), 1_000)
        : resolveGatewayHandshakeTimeoutMs();
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
      if (settled && !handshakeComplete) {
        return;
      }
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
            if (settled) {
              return;
            }
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
      if (settled && !handshakeComplete) {
        return;
      }
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
      if (settled && !handshakeComplete) {
        return;
      }
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
