/**
 * Gateway Process Manager
 * Manages the OpenClaw Gateway process lifecycle
 */
import path from 'path';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import { PORTS, findAvailablePort, isPortAvailable } from '../utils/config';
import { JsonRpcNotification, isNotification, isResponse } from './protocol';
import { logger } from '../utils/logger';
import { loadOrCreateDeviceIdentity, type DeviceIdentity } from '../utils/device-identity';
import { getDataDir } from '../utils/paths';
import {
  DEFAULT_RECONNECT_CONFIG,
  type ReconnectConfig,
  type GatewayLifecycleState,
  getReconnectScheduleDecision,
  getReconnectSkipReason,
} from './process-policy';
import {
  clearPendingGatewayRequests,
  rejectPendingGatewayRequest,
  resolvePendingGatewayRequest,
  type PendingGatewayRequest,
} from './request-store';
import { dispatchJsonRpcNotification, dispatchProtocolEvent } from './event-dispatch';
import { GatewayStateController } from './state';
import {
  getLastStartupPreflightRecovery,
  prepareGatewayLaunchContext,
  runDeferredManagedPluginSync,
  runOpenClawStartupPreflightRepair,
} from './config-sync';
import { connectGatewaySocket, waitForGatewayReady } from './ws-client';
import {
  findExistingGatewayProcess,
  runOpenClawDoctorRepair,
  terminateOwnedGatewayProcess,
  unloadLaunchctlGatewayService,
  waitForPortFree,
  warmupManagedPythonReadiness,
} from './supervisor';
import { GatewayConnectionMonitor } from './connection-monitor';
import { GatewayLifecycleController, LifecycleSupersededError } from './lifecycle-controller';
import { launchGatewayProcess } from './process-launcher';
import { GatewayRestartController } from './restart-controller';
import { GatewayRestartGovernor } from './restart-governor';
import { classifyGatewayStderrMessage, recordGatewayStartupStderrLine } from './startup-stderr';
import { runGatewayStartupSequence } from './startup-orchestrator';
import { recoverMalformedOpenClawConfig } from '../utils/openclaw-config';
import { getSetting } from '../utils/store';
import type { GatewayConfigRecovery } from '../../src/types/gateway';

export interface GatewayStatus {
  state: GatewayLifecycleState;
  port: number;
  pid?: number;
  uptime?: number;
  error?: string;
  connectedAt?: number;
  version?: string;
  reconnectAttempts?: number;
  restartExpectedMs?: number;
}

export interface GatewayRestartOptions {
  strategy?: 'auto' | 'stop-start';
  /** Force immediate restart, bypassing startup lock, governor cooldown, and
   * any deferred-restart queue.  Use this when the user explicitly requests a
   * restart from the Settings UI. */
  force?: boolean;
}

/**
 * Gateway Manager Events
 */
export interface GatewayManagerEvents {
  status: (status: GatewayStatus) => void;
  message: (message: unknown) => void;
  notification: (notification: JsonRpcNotification) => void;
  exit: (code: number | null) => void;
  error: (error: Error) => void;
  'channel:status': (data: { channelId: string; status: string }) => void;
  'chat:message': (data: { message: unknown }) => void;
}

/**
 * Gateway Manager
 * Handles starting, stopping, and communicating with the OpenClaw Gateway
 */
export class GatewayManager extends EventEmitter {
  private static readonly ATTACH_PROBE_COOLDOWN_MS = 8000;
  private process: ChildProcess | null = null;
  private processExitStatus: number | string | null = null;
  private ownsProcess = false;
  private ws: WebSocket | null = null;
  private status: GatewayStatus = { state: 'stopped', port: PORTS.OPENCLAW_GATEWAY };
  private readonly stateController: GatewayStateController;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private reconnectConfig: ReconnectConfig;
  private shouldReconnect = true;
  private startLock = false;
  private lastSpawnSummary: string | null = null;
  private recentStartupStderrLines: string[] = [];
  private pendingRequests: Map<string, PendingGatewayRequest> = new Map();
  private deviceIdentity: DeviceIdentity | null = null;
  private restartInFlight: Promise<void> | null = null;
  private startInFlight: Promise<void> | null = null;
  private readonly connectionMonitor = new GatewayConnectionMonitor();
  private readonly lifecycleController = new GatewayLifecycleController();
  private readonly restartController = new GatewayRestartController();
  private readonly restartGovernor = new GatewayRestartGovernor();
  private lastStartupRecovery: GatewayConfigRecovery | null = null;
  private reloadDebounceTimer: NodeJS.Timeout | null = null;
  private externalShutdownSupported: boolean | null = null;
  private pendingExpectedReconnectDelayMs: number | null = null;
  private attachProbeInFlight: Promise<boolean> | null = null;
  private lastAttachProbeAt = 0;
  private lastAttachProbeFoundGateway = false;
  /** Pre-computed launch context from a prior warmup call. Cleared on each start. */
  private cachedLaunchContext: { context: import('./config-sync').GatewayLaunchContext; port: number } | null = null;

  constructor(config?: Partial<ReconnectConfig>) {
    super();
    this.stateController = new GatewayStateController({
      emitStatus: (status) => {
        this.status = status;
        this.emit('status', status);
      },
      onTransition: (previousState, nextState) => {
        if (nextState === 'running') {
          this.restartGovernor.onRunning();
        }
        this.restartController.flushDeferredRestart(
          `status:${previousState}->${nextState}`,
          {
            state: this.status.state,
            startLock: this.startLock,
            shouldReconnect: this.shouldReconnect,
          },
          {
            reload: () => {
              void this.reload().catch((error) => {
                logger.warn('Deferred Gateway reload failed:', error);
              });
            },
            restart: () => {
              void this.restart().catch((error) => {
                logger.warn('Deferred Gateway restart failed:', error);
              });
            },
          }
        );
      },
    });
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...config };
    // Device identity is loaded lazily in start() — not in the constructor —
    // so that async file I/O and key generation don't block module loading.
  }

  private async initDeviceIdentity(): Promise<void> {
    if (this.deviceIdentity) return; // already loaded
    try {
      const identityPath = path.join(getDataDir(), 'clawclaw-device-identity.json');
      this.deviceIdentity = await loadOrCreateDeviceIdentity(identityPath);
      logger.debug(`Device identity loaded (deviceId=${this.deviceIdentity.deviceId})`);
    } catch (err) {
      logger.warn('Failed to load device identity, scopes will be limited:', err);
    }
  }

  private sanitizeSpawnArgs(args: string[]): string[] {
    const sanitized = [...args];
    const tokenIdx = sanitized.indexOf('--token');
    if (tokenIdx !== -1 && tokenIdx + 1 < sanitized.length) {
      sanitized[tokenIdx + 1] = '[redacted]';
    }
    return sanitized;
  }

  private isUnsupportedShutdownError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /unknown method:\s*shutdown/i.test(message);
  }

  private waitForRunningStateAfterDisconnect(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let sawDisconnect = false;

      const cleanup = () => {
        clearTimeout(timeout);
        this.off('status', onStatus);
      };

      const onStatus = (status: GatewayStatus) => {
        if (
          status.state === 'stopped' ||
          status.state === 'starting' ||
          status.state === 'reconnecting'
        ) {
          sawDisconnect = true;
          return;
        }

        if (status.state === 'running' && sawDisconnect) {
          cleanup();
          resolve();
          return;
        }

        if (status.state === 'error') {
          cleanup();
          reject(new Error(status.error || 'Gateway failed while waiting for restart'));
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for Gateway restart after ${timeoutMs}ms`));
      }, timeoutMs);

      this.on('status', onStatus);
    });
  }

  private async restartOwnedGatewayInPlace(): Promise<void> {
    const child = this.process;
    if (!child?.pid) {
      throw new Error('Cannot restart Gateway in-place without an owned process pid');
    }

    const expectedDelayMs = this.pendingExpectedReconnectDelayMs ?? 1500;
    const waitTimeoutMs = Math.max(8000, expectedDelayMs + 8000);
    const waitForReconnect = this.waitForRunningStateAfterDisconnect(waitTimeoutMs);

    logger.info(`Requesting in-process Gateway restart via SIGUSR1 (pid=${child.pid})`);
    process.kill(child.pid, 'SIGUSR1');
    await waitForReconnect;
  }

  private enrichStartupError(error: unknown): Error {
    const base = error instanceof Error ? error : new Error(String(error));
    const stderrLines = this.recentStartupStderrLines
      .map((line) => line.trim())
      .filter(Boolean);
    if (stderrLines.length === 0) return base;

    const SIGNAL_PATTERNS = [
      /ERR_MODULE_NOT_FOUND/i,
      /Cannot find module/i,
      /Cannot find package/i,
      /MODULE_NOT_FOUND/i,
      /SyntaxError/i,
      /ReferenceError/i,
      /TypeError/i,
      /Error:/i,
      /\.node\b/i,
      /The specified module could not be found/i,
      /A dynamic link library \(DLL\) initialization routine failed/i,
      /Node\.js v\d+\.\d+\+ is required/i,
    ];

    const signalIndex = stderrLines.findIndex((line) =>
      SIGNAL_PATTERNS.some((pattern) => pattern.test(line))
    );
    const excerptStart = signalIndex >= 0
      ? signalIndex
      : Math.max(0, stderrLines.length - 8);
    const excerpt = stderrLines.slice(excerptStart, excerptStart + 8).join(' | ');

    if (!excerpt || base.message.includes(excerpt)) return base;
    return new Error(`${base.message}. Gateway stderr: ${excerpt}`);
  }

  private resetAttachProbeState(): void {
    this.attachProbeInFlight = null;
    this.lastAttachProbeAt = 0;
    this.lastAttachProbeFoundGateway = false;
  }
  /**
   * Get current Gateway status
   */
  getStatus(): GatewayStatus {
    return this.stateController.getStatus();
  }

  getLastStartupRecovery(): GatewayConfigRecovery | null {
    return this.lastStartupRecovery;
  }

  /**
   * Check if Gateway is connected and ready
   */
  isConnected(): boolean {
    return this.stateController.isConnected(this.ws?.readyState === WebSocket.OPEN);
  }

  isStartInProgress(): boolean {
    return this.startLock || this.status.state === 'starting' || this.status.state === 'reconnecting';
  }

  isInStartupStabilizationWindow(windowMs = 8000): boolean {
    if (this.isStartInProgress()) {
      return true;
    }

    if (this.status.state !== 'running' || !this.status.connectedAt) {
      return false;
    }

    return (Date.now() - this.status.connectedAt) < windowMs;
  }

  /**
   * Resolve the port to start the Gateway on.
   *
   * Tries the preferred port (this.status.port) first.  If it is already in use
   * by another process, scans 18789–18899 for the first available port.
   * This enables multiple ClawClaw instances (installed + portable) to coexist
   * on the same machine without manual port configuration.
   */
  private async resolveStartPort(): Promise<void> {
    const preferred = this.status.port;
    if (await isPortAvailable(preferred)) {
      return;
    }
    // Port is occupied — scan for the first free one.
    const resolved = await findAvailablePort(PORTS.OPENCLAW_GATEWAY);
    if (resolved !== preferred) {
      logger.warn(
        `[Gateway] Preferred port ${preferred} is in use; falling back to port ${resolved}`
      );
    }
    this.status.port = resolved;
    this.setStatus({ port: resolved });
  }

  /**
   * Start Gateway process
   */
  async start(): Promise<void> {
    if (this.startInFlight) {
      logger.debug('Gateway start joining existing start flow');
      await this.startInFlight;
      return;
    }

    if (this.status.state === 'running') {
      logger.debug('Gateway already running, skipping start');
      return;
    }

    const startPromise = (async () => {
      this.startLock = true;
      this.lastStartupRecovery = null;
      this.resetAttachProbeState();
      const startEpoch = this.lifecycleController.bump('start');

      // Resolve an available port before starting — allows multiple instances
      // (installed + portable) to coexist on the same machine.
      await this.resolveStartPort();
      logger.info(`Gateway start requested (port=${this.status.port})`);
      this.lastSpawnSummary = null;
      this.shouldReconnect = true;

      // Lazily load device identity (async file I/O + key generation).
      // Must happen before connect() which uses the identity for the handshake.
      await this.initDeviceIdentity();

      // Manual start should override and cancel any pending reconnect timer.
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        logger.debug('Cleared pending reconnect timer because start was requested manually');
      }

      this.reconnectAttempts = 0;
      this.setStatus({ state: 'starting', reconnectAttempts: 0, restartExpectedMs: undefined });

      // Check if Python environment is ready (self-healing) asynchronously.
      // Fire-and-forget: only needs to run once, not on every retry.
      warmupManagedPythonReadiness();

      if (this.process && this.ownsProcess && this.processExitStatus === null) {
        const lingeringProcess = this.process;
        logger.info(
          `Terminating lingering owned Gateway process before startup (pid=${lingeringProcess.pid ?? 'unknown'})`
        );
        await terminateOwnedGatewayProcess(lingeringProcess);
        if (this.process === lingeringProcess) {
          this.process = null;
        }
        this.ownsProcess = false;
        this.processExitStatus = null;
        this.setStatus({ pid: undefined });
      }

      try {
        await runGatewayStartupSequence({
          port: this.status.port,
          ownedPid: this.process?.pid,
          shouldWaitForPortFree: process.platform === 'win32',
          maxStartAttempts: 90,
          resetStartupStderrLines: () => {
            this.recentStartupStderrLines = [];
          },
          getStartupStderrLines: () => this.recentStartupStderrLines,
          assertLifecycle: (phase) => {
            this.lifecycleController.assert(startEpoch, phase);
          },
          findExistingGateway: async (port, ownedPid) => {
            return await findExistingGatewayProcess({ port, ownedPid });
          },
          connect: async (port, externalToken) => {
            await this.connect(port, externalToken);
          },
          onConnectingToExistingGateway: () => {
            this.setStatus({
              state: 'reconnecting',
              error: undefined,
              reconnectAttempts: 0,
              pid: undefined,
              restartExpectedMs: undefined,
            });
          },
          onConnectedToExistingGateway: () => {
            this.ownsProcess = false;
            this.setStatus({ pid: undefined });
            this.startHealthCheck();
          },
          waitForPortFree: async (port) => {
            await waitForPortFree(port);
          },
          startProcess: async () => {
            await this.startProcess();
          },
          waitForReady: async (port) => {
            await waitForGatewayReady({
              port,
              getProcessExitCode: () => this.processExitStatus,
            });
          },
          onConnectedToManagedGateway: () => {
            this.startHealthCheck();
            logger.debug('Gateway started successfully');
            // Deferred: sync managed channel plugin mirrors after Gateway is up.
            // Blocking plugin copy during preflight would delay startup; these
            // plugins are optional China-channel extensions — non-fatal if absent.
            runDeferredManagedPluginSync();
          },
          recoverMalformedConfig: async () => {
            try {
              const result = await recoverMalformedOpenClawConfig();
              if (result.outcome === 'repaired') {
                this.lastStartupRecovery = {
                  kind: 'config-repaired',
                  strategy: result.strategy,
                  backupPath: result.backupPath ?? undefined,
                  topics: ['config'],
                };
                logger.warn(
                  `Repaired malformed openclaw.json during Gateway startup${result.backupPath ? ` (backup: ${result.backupPath})` : ''}${result.strategy ? ` using ${result.strategy}` : ''}`,
                );
              } else if (result.outcome === 'reset') {
                this.lastStartupRecovery = {
                  kind: 'config-reset',
                  strategy: result.strategy,
                  backupPath: result.backupPath ?? undefined,
                  topics: ['config'],
                };
                logger.warn(
                  `Reset malformed openclaw.json during Gateway startup${result.backupPath ? ` (backup: ${result.backupPath})` : ''}`,
                );
              } else {
                logger.warn('Malformed openclaw.json recovery was requested, but no config file was present');
              }
              return true;
            } catch (resetError) {
              logger.error('Failed to recover malformed openclaw.json during Gateway startup:', resetError);
              return false;
            }
          },
          onMalformedConfigRecoverySuccess: () => {
            this.setStatus({ state: 'starting', error: undefined, reconnectAttempts: 0, restartExpectedMs: undefined });
          },
          runDoctorRepair: async () => {
            try {
              await runOpenClawStartupPreflightRepair();
              logger.info('OpenClaw startup preflight repair completed; retrying Gateway startup');
              return true;
            } catch (preflightError) {
              logger.warn('OpenClaw startup preflight repair failed; falling back to doctor --fix:', preflightError);
            }
            return await runOpenClawDoctorRepair();
          },
          onDoctorRepairSuccess: () => {
            this.setStatus({ state: 'starting', error: undefined, reconnectAttempts: 0, restartExpectedMs: undefined });
          },
          delay: async (ms) => {
            await new Promise((resolve) => setTimeout(resolve, ms));
          },
        });
      } catch (error) {
        if (error instanceof LifecycleSupersededError) {
          logger.debug(error.message);
          return;
        }
        const enrichedError = this.enrichStartupError(error);
        logger.error(
          `Gateway start failed (port=${this.status.port}, reconnectAttempts=${this.reconnectAttempts}, spawn=${this.lastSpawnSummary ?? 'n/a'})`,
          enrichedError
        );
        this.setStatus({ state: 'error', error: String(enrichedError), restartExpectedMs: undefined });
        throw enrichedError;
      } finally {
        this.startLock = false;
        this.restartController.flushDeferredRestart(
          'start:finally',
          {
            state: this.status.state,
            startLock: this.startLock,
            shouldReconnect: this.shouldReconnect,
          },
          {
            reload: () => {
              void this.reload().catch((error) => {
                logger.warn('Deferred Gateway reload failed:', error);
              });
            },
            restart: () => {
              void this.restart().catch((error) => {
                logger.warn('Deferred Gateway restart failed:', error);
              });
            },
          }
        );
      }
    })();

    this.startInFlight = startPromise;
    try {
      await startPromise;
    } finally {
      if (this.startInFlight === startPromise) {
        this.startInFlight = null;
      }
    }
  }

  /**
   * Attach to an already running Gateway without starting a new process.
   * This is used when the Electron host restarts or reloads while OpenClaw
   * is still alive, so the UI can recover its real connection state.
   */
  async attachIfRunning(options?: { force?: boolean }): Promise<boolean> {
    const force = options?.force === true;

    if (this.startLock) {
      logger.debug('Gateway attach skipped because a start flow is already in progress');
      return false;
    }

    if (this.status.state === 'running' && this.ws?.readyState === WebSocket.OPEN) {
      return true;
    }

    if (this.attachProbeInFlight) {
      return await this.attachProbeInFlight;
    }

    if (
      !force &&
      !this.lastAttachProbeFoundGateway &&
      this.lastAttachProbeAt > 0 &&
      (Date.now() - this.lastAttachProbeAt) < GatewayManager.ATTACH_PROBE_COOLDOWN_MS
    ) {
      return false;
    }

    await this.initDeviceIdentity();

    this.attachProbeInFlight = (async () => {
      this.lastAttachProbeAt = Date.now();
      try {
      logger.debug(`Checking for attachable existing Gateway on port ${this.status.port}...`);
      const existing = await findExistingGatewayProcess({
        port: this.status.port,
        ownedPid: this.process?.pid,
        terminateUnexpected: false,
      });
      if (!existing) {
        this.lastAttachProbeFoundGateway = false;
        logger.info(`Gateway attach decision: no existing Gateway available on port ${this.status.port}`);
        return false;
      }

      logger.info(`Attaching to existing Gateway on port ${existing.port}`);
      this.shouldReconnect = true;
      this.reconnectAttempts = 0;
      this.setStatus({
        state: 'reconnecting',
        error: undefined,
        reconnectAttempts: 0,
        pid: undefined,
        restartExpectedMs: undefined,
      });
      await this.connect(existing.port, existing.externalToken);
      this.ownsProcess = false;
      this.process = null;
      this.processExitStatus = null;
      this.lastAttachProbeFoundGateway = true;
      this.startHealthCheck();
      logger.info(`Gateway attach decision: connected to existing Gateway on port ${existing.port}`);
      return true;
    } catch (error) {
      this.lastAttachProbeFoundGateway = false;
      logger.warn(`Gateway attach decision: failed on port ${this.status.port}:`, error);
      this.setStatus({
        state: 'stopped',
        error: undefined,
        pid: undefined,
        connectedAt: undefined,
        uptime: undefined,
        restartExpectedMs: undefined,
      });
      return false;
      } finally {
        this.attachProbeInFlight = null;
      }
    })();

    return await this.attachProbeInFlight;
  }

  /**
   * Stop Gateway process
   */
  async stop(): Promise<void> {
    logger.info('Gateway stop requested');
    this.resetAttachProbeState();
    this.lifecycleController.bump('stop');
    // Disable auto-reconnect
    this.shouldReconnect = false;

    // Clear all timers
    this.clearAllTimers();

    // If this manager is attached to an external gateway process, ask it to shut down
    // over protocol before closing the socket.
    if (
      !this.ownsProcess &&
      this.ws?.readyState === WebSocket.OPEN &&
      this.externalShutdownSupported !== false
    ) {
      try {
        await this.rpc('shutdown', undefined, 5000);
        this.externalShutdownSupported = true;
      } catch (error) {
        if (this.isUnsupportedShutdownError(error)) {
          this.externalShutdownSupported = false;
          logger.info(
            'External Gateway does not support "shutdown"; skipping shutdown RPC for future stops'
          );
        } else {
          logger.warn('Failed to request shutdown for externally managed Gateway:', error);
        }
      }
    }

    // Close WebSocket — terminate() forcefully closes the TCP connection
    // without waiting for the WebSocket close handshake, which is
    // appropriate when the Gateway process itself is being stopped.
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        // ignore — the connection may already be dead
      }
      this.ws = null;
    }

    // Kill process
    if (this.process && this.ownsProcess) {
      const child = this.process;
      await terminateOwnedGatewayProcess(child);

      if (this.process === child) {
        this.process = null;
      }
    }
    this.ownsProcess = false;

    clearPendingGatewayRequests(this.pendingRequests, new Error('Gateway stopped'));

    this.restartController.resetDeferredRestart();
    this.setStatus({
      state: 'stopped',
      error: undefined,
      pid: undefined,
      connectedAt: undefined,
      uptime: undefined,
      restartExpectedMs: undefined,
    });
  }

  /**
   * Restart Gateway process
   */
  async restart(options?: GatewayRestartOptions): Promise<void> {
    // ── Force restart: bypasses all deferral/governor logic and stops/starts
    // immediately.  Used when the user explicitly requests a restart from the
    // Settings UI — it must work regardless of gateway state.
    if (options?.force) {
      await this.forceRestart();
      return;
    }

    if (
      this.restartController.isRestartDeferred({
        state: this.status.state,
        startLock: this.startLock,
      })
    ) {
      this.restartController.markDeferredRestart('restart', {
        state: this.status.state,
        startLock: this.startLock,
      }, 'restart');
      return;
    }

    if (this.restartInFlight) {
      logger.debug('Gateway restart already in progress, joining existing request');
      await this.restartInFlight;
      return;
    }

    logger.debug('Gateway restart requested');
    this.restartInFlight = (async () => {
      const decision = this.restartGovernor.decide();
      if (!decision.allow) {
        logger.warn(
          `Gateway restart suppressed (${decision.reason}); retrying in ${decision.retryAfterMs}ms`,
        );
        this.debouncedRestart(Math.max(250, decision.retryAfterMs));
        return;
      }
      this.restartGovernor.recordExecuted();

      const strategy = options?.strategy ?? 'auto';
      const canUseInPlaceRestart =
        strategy === 'auto' &&
        process.platform !== 'win32' &&
        this.ownsProcess &&
        this.process?.pid != null &&
        this.status.state === 'running';

      if (canUseInPlaceRestart) {
        try {
          await this.restartOwnedGatewayInPlace();
          return;
        } catch (error) {
          logger.warn('In-process Gateway restart failed, falling back to stop/start:', error);
          if (this.startInFlight) {
            logger.info('Waiting for in-flight Gateway start before stop/start fallback');
            try {
              await this.startInFlight;
            } catch (startError) {
              logger.warn('In-flight Gateway start failed after in-process restart fallback:', startError);
            }
            if (this.status.state === 'running') {
              logger.info('Gateway recovered while restart fallback was pending; skipping stop/start');
              return;
            }
          }
        }
      }

      await this.stop();
      await this.start();
    })();

    try {
      await this.restartInFlight;
    } finally {
      this.restartInFlight = null;
      this.restartController.flushDeferredRestart(
        'restart:finally',
        {
          state: this.status.state,
          startLock: this.startLock,
          shouldReconnect: this.shouldReconnect,
        },
        {
          reload: () => {
            void this.reload().catch((error) => {
              logger.warn('Deferred Gateway reload failed:', error);
            });
          },
          restart: () => {
            void this.restart().catch((error) => {
              logger.warn('Deferred Gateway restart failed:', error);
            });
          },
        }
      );
    }
  }

  /**
   * Force immediate restart — stops the gateway right now and starts a new one,
   * ignoring startup locks, governor suppression, and deferred queues.  Any in-flight
   * stop/start operations are abandoned.
   */
  private async forceRestart(): Promise<void> {
    logger.info('Force Gateway restart requested');

    // 1. Reset all barriers
    this.startLock = false;
    this.restartGovernor.reset();
    this.restartController.resetDeferredRestart();
    this.restartController.clearDebounceTimer();

    // 2. Abandon any in-flight stop/start so we don't wait on them
    this.startInFlight = null;
    this.restartInFlight = null;

    // 3. Clear all timers so nothing fires during the transition
    this.clearAllTimers();

    // 4. Stop immediately (synchronously-set flags only; no awaits on previous ops)
    // Re-enable reconnect for the upcoming start
    this.shouldReconnect = true;
    await this.stop();

    // 5. Start fresh
    await this.start();
  }

  /**
   * Reset the restart governor — clears restart budget, cooldown, and circuit-breaker
   * state.  Used by the port-scanner kill API so killing an external gateway
   * doesn't get suppressed by the governor on the next restart.
   */
  public resetGovernor(): void {
    this.restartGovernor.reset();
  }

  /**
   * Pre-warm the launch context in the background — runs `prepareGatewayLaunchContext`
   * while the window is loading so `startProcess()` can reuse the result without
   * recomputing (saving ~8 s of keychain reads on the critical path).
   *
   * This is called fire-and-forget from `initialize()` in the main process.
   * If `start()` is called before warmup finishes, it falls through to computing
   * the context normally (no correctness impact, just no speedup).
   */
  public async prewarmLaunchContext(): Promise<void> {
    try {
      const targetPort = this.status.port || PORTS.OPENCLAW_GATEWAY;
      logger.debug(`[warmup] Pre-computing Gateway launch context for port ${targetPort}…`);
      const context = await prepareGatewayLaunchContext(targetPort);
      this.cachedLaunchContext = { context, port: targetPort };
      logger.debug('[warmup] Gateway launch context ready and cached');
    } catch (err) {
      logger.debug('[warmup] Could not pre-warm launch context (non-fatal):', err);
      this.cachedLaunchContext = null;
    }
  }

  /**
   * Debounced restart — coalesces multiple rapid restart requests into a
   * single restart after `delayMs` of inactivity.  This prevents the
   * cascading stop/start cycles that occur when provider:save,
   * provider:setDefault and channel:saveConfig all fire within seconds
   * of each other during setup.
   */
  debouncedRestart(delayMs = 2000): void {
    this.restartController.debouncedRestart(delayMs, () => {
      void this.restart().catch((err) => {
        logger.warn('Debounced Gateway restart failed:', err);
      });
    });
  }

  /**
   * Ask the Gateway process to reload config in-place when possible.
   * Falls back to restart on unsupported platforms or signaling failures.
   */
  async reload(): Promise<void> {
    if (
      this.restartController.isRestartDeferred({
        state: this.status.state,
        startLock: this.startLock,
      })
    ) {
      this.restartController.markDeferredRestart('reload', {
        state: this.status.state,
        startLock: this.startLock,
      }, 'reload');
      return;
    }

    if (!this.process?.pid || this.status.state !== 'running') {
      logger.warn('Gateway reload requested while not running; falling back to restart');
      await this.restart();
      return;
    }

    if (process.platform === 'win32') {
      logger.debug('Windows detected, falling back to Gateway restart for reload');
      await this.restart();
      return;
    }

    const connectedForMs = this.status.connectedAt
      ? Date.now() - this.status.connectedAt
      : Number.POSITIVE_INFINITY;

    // Avoid signaling a process that just came up; it will already read latest config.
    if (connectedForMs < 8000) {
      logger.info(`Gateway connected ${connectedForMs}ms ago, skipping reload signal`);
      return;
    }

    try {
      process.kill(this.process.pid, 'SIGUSR1');
      logger.info(`Sent SIGUSR1 to Gateway for config reload (pid=${this.process.pid})`);
      // Some gateway builds do not handle SIGUSR1 as an in-process reload.
      // If process state doesn't recover quickly, fall back to restart.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (this.status.state !== 'running' || !this.process?.pid) {
        logger.warn('Gateway did not stay running after reload signal, falling back to restart');
        await this.restart();
      }
    } catch (error) {
      logger.warn('Gateway reload signal failed, falling back to restart:', error);
      await this.restart();
    }
  }

  /**
   * Debounced reload — coalesces multiple rapid config-change events into one
   * in-process reload when possible.
   */
  debouncedReload(delayMs = 1200): void {
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
    }
    logger.debug(`Gateway reload debounced (will fire in ${delayMs}ms)`);
    this.reloadDebounceTimer = setTimeout(() => {
      this.reloadDebounceTimer = null;
      void this.reload().catch((err) => {
        logger.warn('Debounced Gateway reload failed:', err);
      });
    }, delayMs);
  }

  /**
   * Clear all active timers
   */
  private clearAllTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connectionMonitor.clear();
    this.restartController.clearDebounceTimer();
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = null;
    }
  }

  /**
   * Make an RPC call to the Gateway
   * Uses OpenClaw protocol format: { type: "req", id: "...", method: "...", params: {...} }
   */
  async rpc<T>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Gateway not connected'));
        return;
      }

      const id = crypto.randomUUID();

      // Set timeout for request
      const timeout = setTimeout(() => {
        rejectPendingGatewayRequest(this.pendingRequests, id, new Error(`RPC timeout: ${method}`));
      }, timeoutMs);

      // Store pending request
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      // Send request using OpenClaw protocol format
      const request = {
        type: 'req',
        id,
        method,
        params,
      };

      try {
        this.ws.send(JSON.stringify(request));
      } catch (error) {
        rejectPendingGatewayRequest(
          this.pendingRequests,
          id,
          new Error(`Failed to send RPC request: ${error}`)
        );
      }
    });
  }

  /**
   * Start health check monitoring
   */
  private startHealthCheck(): void {
    this.connectionMonitor.startHealthCheck({
      shouldCheck: () => this.status.state === 'running',
      checkHealth: () => this.checkHealth(),
      onUnhealthy: (errorMessage) => {
        this.emit('error', new Error(errorMessage));
      },
      onError: () => {
        // The monitor already logged the error; nothing else to do here.
      },
    });
  }

  /**
   * Check Gateway health via WebSocket ping
   * OpenClaw Gateway doesn't have an HTTP /health endpoint
   */
  async checkHealth(): Promise<{ ok: boolean; error?: string; uptime?: number }> {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const uptime = this.status.connectedAt
          ? Math.floor((Date.now() - this.status.connectedAt) / 1000)
          : undefined;
        return { ok: true, uptime };
      }
      return { ok: false, error: 'WebSocket not connected' };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  /**
   * Start Gateway process
   * Uses OpenClaw npm package from node_modules (dev) or resources (production)
   */
  private async startProcess(): Promise<void> {
    const cachedCtx = this.cachedLaunchContext;
    const useCached = Boolean(cachedCtx) && cachedCtx.port === this.status.port;
    const launchContext: import('./config-sync').GatewayLaunchContext = useCached
      ? cachedCtx.context
      : await prepareGatewayLaunchContext(this.status.port);
    // Always clear after use (or if stale) — TypeScript type narrowing on the
    // local `cachedCtx` const prevents ESLint from flagging this as a no-op.
    this.cachedLaunchContext = null;
    if (useCached) {
      logger.debug('Using pre-warmed Gateway launch context');
    } else {
      logger.debug('Preparing Gateway launch context…');
    }
    this.lastStartupRecovery = getLastStartupPreflightRecovery();
    logger.debug('Gateway launch context ready');
    logger.debug('Ensuring legacy launchctl Gateway service is unloaded...');
    await unloadLaunchctlGatewayService();
    logger.debug('Legacy launchctl Gateway service check complete');
    this.processExitStatus = null;

    const { child, lastSpawnSummary } = await launchGatewayProcess({
      port: this.status.port,
      launchContext,
      sanitizeSpawnArgs: (args) => this.sanitizeSpawnArgs(args),
      getCurrentState: () => this.status.state,
      getShouldReconnect: () => this.shouldReconnect,
      onStderrLine: (line) => {
        recordGatewayStartupStderrLine(this.recentStartupStderrLines, line);
        const classified = classifyGatewayStderrMessage(line);
        if (classified.level === 'drop') return;
        if (classified.level === 'debug') {
          logger.debug(`[Gateway stderr] ${classified.normalized}`);
          return;
        }
        logger.warn(`[Gateway stderr] ${classified.normalized}`);
      },
      onSpawn: (pid) => {
        this.setStatus({ pid });
      },
      onExit: (exitedChild, code, signal) => {
        this.processExitStatus = code ?? signal ?? 'unknown';
        this.ownsProcess = false;
        if (this.process === exitedChild) {
          this.process = null;
        }
        clearPendingGatewayRequests(
          this.pendingRequests,
          new Error(`Gateway process exited (${code ?? signal ?? 'unknown'})`),
        );
        this.emit('exit', code);

        if (this.status.state === 'running') {
          this.setStatus({ state: 'stopped', restartExpectedMs: undefined });
          this.scheduleReconnect();
        }
      },
      onError: () => {
        this.ownsProcess = false;
        if (this.process === child) {
          this.process = null;
        }
      },
    });

    this.process = child;
    this.ownsProcess = true;
    this.lastSpawnSummary = lastSpawnSummary;
    this.lastAttachProbeFoundGateway = false;
  }

  /**
   * Connect WebSocket to Gateway
   */
  private async connect(port: number, _externalToken?: string): Promise<void> {
    this.ws = await connectGatewaySocket({
      port,
      deviceIdentity: this.deviceIdentity,
      platform: process.platform,
      getToken: async () => await getSetting('gatewayToken'),
      onHandshakeComplete: (ws) => {
        this.ws = ws;
        this.setStatus({
          state: 'running',
          port,
          connectedAt: Date.now(),
          restartExpectedMs: undefined,
        });
        this.startPing();
      },
      onMessage: (message) => {
        this.handleMessage(message);
      },
      onCloseAfterHandshake: () => {
        this.lastAttachProbeFoundGateway = false;
        clearPendingGatewayRequests(
          this.pendingRequests,
          new Error('Gateway connection closed during request'),
        );
        if (this.status.state === 'running') {
          this.setStatus({ state: 'stopped', restartExpectedMs: undefined });
          this.scheduleReconnect();
        }
      },
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) {
      logger.debug('Received non-object Gateway message');
      return;
    }

    const msg = message as Record<string, unknown>;

    // Handle OpenClaw protocol response format: { type: "res", id: "...", ok: true/false, ... }
    if (msg.type === 'res' && typeof msg.id === 'string') {
      if (msg.ok === false || msg.error) {
        const errorObj = msg.error as { message?: string; code?: number } | undefined;
        const errorMsg = errorObj?.message || JSON.stringify(msg.error) || 'Unknown error';
        if (rejectPendingGatewayRequest(this.pendingRequests, msg.id, new Error(errorMsg))) {
          return;
        }
      } else if (resolvePendingGatewayRequest(this.pendingRequests, msg.id, msg.payload ?? msg)) {
        return;
      }
    }

    // Handle OpenClaw protocol event format: { type: "event", event: "...", payload: {...} }
    if (msg.type === 'event' && typeof msg.event === 'string') {
      if (msg.event === 'shutdown' && typeof msg.payload === 'object' && msg.payload !== null) {
        const payload = msg.payload as { restartExpectedMs?: unknown };
        if (
          typeof payload.restartExpectedMs === 'number' &&
          Number.isFinite(payload.restartExpectedMs) &&
          payload.restartExpectedMs >= 0
        ) {
          this.pendingExpectedReconnectDelayMs = Math.max(0, Math.floor(payload.restartExpectedMs));
          logger.info(
            `Gateway announced restart window (${this.pendingExpectedReconnectDelayMs}ms); preparing fast reconnect`
          );
        } else {
          this.pendingExpectedReconnectDelayMs = null;
        }
      }
      dispatchProtocolEvent(this, msg.event, msg.payload);
      return;
    }

    // Fallback: Check if this is a JSON-RPC 2.0 response (legacy support)
    if (isResponse(message) && message.id && this.pendingRequests.has(String(message.id))) {
      if (message.error) {
        const errorMsg =
          typeof message.error === 'object'
            ? (message.error as { message?: string }).message || JSON.stringify(message.error)
            : String(message.error);
        rejectPendingGatewayRequest(this.pendingRequests, String(message.id), new Error(errorMsg));
      } else {
        resolvePendingGatewayRequest(this.pendingRequests, String(message.id), message.result);
      }
      return;
    }

    // Check if this is a JSON-RPC notification (server-initiated event)
    if (isNotification(message)) {
      dispatchJsonRpcNotification(this, message);
      return;
    }

    this.emit('message', message);
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPing(): void {
    this.connectionMonitor.startPing(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    });
  }

  /**
   * Schedule reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.pendingExpectedReconnectDelayMs !== null) {
      const delay = this.pendingExpectedReconnectDelayMs;
      this.pendingExpectedReconnectDelayMs = null;

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      logger.info(`Scheduling fast Gateway reconnect in ${delay}ms (server-announced restart)`);
      this.setStatus({
        state: 'reconnecting',
        reconnectAttempts: this.reconnectAttempts,
        restartExpectedMs: delay,
      });
      const scheduledEpoch = this.lifecycleController.getCurrentEpoch();

      // ✅ Fix HR-4: Use inFlight flag to prevent re-entrancy and make timer lifecycle explicit.
      let inFlight = false;
      this.reconnectTimer = setTimeout(async () => {
        if (inFlight) {
          logger.debug('Reconnect already in flight, skipping duplicate timer');
          return;
        }
        inFlight = true;
        try {
          const skipReason = getReconnectSkipReason({
            scheduledEpoch,
            currentEpoch: this.lifecycleController.getCurrentEpoch(),
            shouldReconnect: this.shouldReconnect,
          });
          if (skipReason) {
            logger.debug(`Skipping fast reconnect attempt: ${skipReason}`);
            return;
          }
          try {
            await this.start();
            this.reconnectAttempts = 0;
          } catch (error) {
            logger.error('Fast Gateway reconnection attempt failed:', error);
            this.scheduleReconnect();
          }
        } finally {
          inFlight = false;
          this.reconnectTimer = null;
        }
      }, delay);
      return;
    }

    const decision = getReconnectScheduleDecision({
      shouldReconnect: this.shouldReconnect,
      hasReconnectTimer: this.reconnectTimer !== null,
      reconnectAttempts: this.reconnectAttempts,
      maxAttempts: this.reconnectConfig.maxAttempts,
      baseDelay: this.reconnectConfig.baseDelay,
      maxDelay: this.reconnectConfig.maxDelay,
    });

    if (decision.action === 'skip') {
      logger.debug(`Gateway reconnect skipped (${decision.reason})`);
      return;
    }

    if (decision.action === 'already-scheduled') {
      return;
    }

    if (decision.action === 'fail') {
      logger.error(`Gateway reconnect failed: max attempts reached (${decision.maxAttempts})`);
      this.setStatus({
        state: 'error',
        error: 'Failed to reconnect after maximum attempts',
        reconnectAttempts: this.reconnectAttempts,
        restartExpectedMs: undefined,
      });
      return;
    }

    const { delay, nextAttempt, maxAttempts } = decision;
    this.reconnectAttempts = nextAttempt;
    logger.warn(`Scheduling Gateway reconnect attempt ${nextAttempt}/${maxAttempts} in ${delay}ms`);

    this.setStatus({
      state: 'reconnecting',
      reconnectAttempts: this.reconnectAttempts,
      restartExpectedMs: undefined,
    });
    const scheduledEpoch = this.lifecycleController.getCurrentEpoch();

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const skipReason = getReconnectSkipReason({
        scheduledEpoch,
        currentEpoch: this.lifecycleController.getCurrentEpoch(),
        shouldReconnect: this.shouldReconnect,
      });
      if (skipReason) {
        logger.debug(`Skipping reconnect attempt: ${skipReason}`);
        return;
      }
      try {
        // Use the guarded start() flow so reconnect attempts cannot bypass
        // lifecycle locking and accidentally start duplicate Gateway processes.
        await this.start();
        this.reconnectAttempts = 0;
      } catch (error) {
        logger.error('Gateway reconnection attempt failed:', error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Update status and emit event
   */
  private setStatus(update: Partial<GatewayStatus>): void {
    this.stateController.setStatus(update);
  }
}
