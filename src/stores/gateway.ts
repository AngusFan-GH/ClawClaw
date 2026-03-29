/**
 * Gateway State Store
 * Uses Host API + SSE for lifecycle/status and a direct renderer WebSocket for runtime RPC.
 */
import { create } from 'zustand';
import { invokeIpc } from '@/lib/api-client';
import { formatGatewayConnectError } from '@/lib/gateway-connect-error';
import { subscribeHostEvent } from '@/lib/host-events';
import type { GatewayLifecycle, GatewayStatus } from '../types/gateway';

let gatewayInitPromise: Promise<void> | null = null;
let gatewayEventUnsubscribers: Array<() => void> | null = null;
let lifecycleClearTimer: ReturnType<typeof setTimeout> | null = null;
let gatewayStatusPollTimer: ReturnType<typeof setInterval> | null = null;
let gatewayVisibilityCleanup: (() => void) | null = null;
let lastPassiveGatewayStatusRefreshAt = 0;

const GATEWAY_ACTIVE_POLL_MS = 2000;
const GATEWAY_IDLE_POLL_MS = 10000;

interface GatewayHealth {
  ok: boolean;
  error?: string;
  uptime?: number;
}

interface GatewayState {
  status: GatewayStatus;
  lifecycle: GatewayLifecycle;
  health: GatewayHealth | null;
  isInitialized: boolean;
  lastError: string | null;
  overlaySuppressed: boolean;
  init: () => Promise<void>;
  refreshStatus: () => Promise<GatewayStatus | null>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  checkHealth: () => Promise<GatewayHealth>;
  rpc: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  setStatus: (status: GatewayStatus) => void;
  setOverlaySuppressed: (suppressed: boolean) => void;
  clearError: () => void;
}

function extractExpectedRestartDelayMs(
  notification: { method?: string; params?: Record<string, unknown> } | undefined,
): number | null {
  if (!notification || notification.method !== 'shutdown') {
    return null;
  }
  const params = notification.params;
  const restartExpectedMs = params?.restartExpectedMs;
  if (typeof restartExpectedMs !== 'number' || !Number.isFinite(restartExpectedMs) || restartExpectedMs < 0) {
    return null;
  }
  return Math.max(0, Math.floor(restartExpectedMs));
}

function handleGatewayNotification(notification: { method?: string; params?: Record<string, unknown> } | undefined): void {
  const payload = notification;
  if (!payload || payload.method !== 'agent' || !payload.params || typeof payload.params !== 'object') {
    return;
  }

  const p = payload.params;
  const data = (p.data && typeof p.data === 'object') ? (p.data as Record<string, unknown>) : {};
  const phase = data.phase ?? p.phase;
  const hasChatData = (p.state ?? data.state) || (p.message ?? data.message);

  import('./chat')
    .then(({ useChatStore }) => {
      useChatStore.getState().handleAgentEvent({
        runId: typeof (p.runId ?? data.runId) === 'string' ? String(p.runId ?? data.runId) : undefined,
        sessionKey: typeof (p.sessionKey ?? data.sessionKey) === 'string' ? String(p.sessionKey ?? data.sessionKey) : undefined,
        stream: typeof (p.stream ?? data.stream) === 'string' ? String(p.stream ?? data.stream) : undefined,
        seq: typeof (p.seq ?? data.seq) === 'number' ? Number(p.seq ?? data.seq) : undefined,
        ts: typeof (p.ts ?? data.ts) === 'number' ? Number(p.ts ?? data.ts) : undefined,
        data,
      });
    })
    .catch(() => {});

  if (hasChatData) {
    const normalizedEvent: Record<string, unknown> = {
      ...data,
      runId: p.runId ?? data.runId,
      sessionKey: p.sessionKey ?? data.sessionKey,
      stream: p.stream ?? data.stream,
      seq: p.seq ?? data.seq,
      state: p.state ?? data.state,
      message: p.message ?? data.message,
    };
    import('./chat')
      .then(({ useChatStore }) => {
        useChatStore.getState().handleChatEvent(normalizedEvent);
      })
      .catch(() => {});
  }

  const runId = p.runId ?? data.runId;
  const sessionKey = p.sessionKey ?? data.sessionKey;
  if (phase === 'started' && runId != null && sessionKey != null) {
    import('./chat')
      .then(({ useChatStore }) => {
        useChatStore.getState().handleChatEvent({
          state: 'started',
          runId,
          sessionKey,
        });
      })
      .catch(() => {});
  }

  if (phase === 'completed' || phase === 'done' || phase === 'finished' || phase === 'end') {
    import('./chat')
      .then(({ useChatStore }) => {
        const state = useChatStore.getState();
        state.loadHistory(true);
        if (state.sending) {
          useChatStore.setState({
            sending: false,
            activeRunId: null,
            pendingFinal: false,
            lastUserMessageAt: null,
          });
        }
      })
      .catch(() => {});
  }
}

function handleGatewayChatMessage(data: unknown): void {
  import('./chat').then(({ useChatStore }) => {
    const chatData = data as Record<string, unknown>;
    const payload = ('message' in chatData && typeof chatData.message === 'object')
      ? chatData.message as Record<string, unknown>
      : chatData;

    if (payload.state) {
      useChatStore.getState().handleChatEvent(payload);
      return;
    }

    useChatStore.getState().handleChatEvent({
      state: 'final',
      message: payload,
      runId: chatData.runId ?? payload.runId,
    });
  }).catch(() => {});
}

function scheduleLifecycleClear(set: (partial: Partial<GatewayState>) => void, delayMs = 2200): void {
  if (lifecycleClearTimer) {
    clearTimeout(lifecycleClearTimer);
  }
  lifecycleClearTimer = setTimeout(() => {
    lifecycleClearTimer = null;
    set({ lifecycle: { state: 'idle' } });
  }, delayMs);
}

async function fetchGatewayStatusSnapshot(): Promise<GatewayStatus> {
  return invokeIpc<GatewayStatus>('gateway:status');
}

function isLifecyclePending(lifecycle: GatewayLifecycle): boolean {
  return lifecycle.state === 'scheduled' || lifecycle.state === 'applying';
}

function shouldPromoteLifecycleToCompleted(
  lifecycle: GatewayLifecycle,
  status: GatewayStatus,
): boolean {
  return status.state === 'running' && isLifecyclePending(lifecycle);
}

function normalizeGatewayStatus(status: GatewayStatus): GatewayStatus {
  if (!status.error) {
    return status;
  }
  return {
    ...status,
    error: formatGatewayConnectError({ message: status.error }),
  };
}

function reconcileLifecycleWithStatus(
  lifecycle: GatewayLifecycle,
  status: GatewayStatus,
): GatewayLifecycle {
  if (status.state === 'starting' && lifecycle.state === 'idle') {
    return {
      ...lifecycle,
      state: 'applying',
      action: lifecycle.action ?? 'start',
      source: lifecycle.source ?? 'gateway.autoStart',
      reason: lifecycle.reason ?? 'gateway.autoStart',
      error: undefined,
      at: lifecycle.at ?? Date.now(),
    };
  }

  if (shouldPromoteLifecycleToCompleted(lifecycle, status)) {
    return {
      ...lifecycle,
      state: 'completed',
      error: undefined,
      delayMs: undefined,
      at: Date.now(),
    };
  }

  if (status.state === 'error' && isLifecyclePending(lifecycle)) {
    return {
      ...lifecycle,
      state: 'failed',
      error: status.error,
      delayMs: undefined,
      at: Date.now(),
    };
  }

  if (
    (status.state === 'reconnecting' && (typeof status.restartExpectedMs === 'number' || isLifecyclePending(lifecycle))) ||
    (status.state === 'starting' && isLifecyclePending(lifecycle))
  ) {
    return {
      ...lifecycle,
      state: 'applying',
      action: lifecycle.action ?? (status.state === 'reconnecting' ? 'restart' : undefined),
      delayMs: status.restartExpectedMs ?? lifecycle.delayMs,
      error: undefined,
      at: lifecycle.at ?? Date.now(),
    };
  }

  return lifecycle;
}

async function reconcileGatewayStatus(
  set: (partial: Partial<GatewayState> | ((state: GatewayState) => Partial<GatewayState>)) => void,
  target: 'running' | 'stopped',
  timeoutMs = 15000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = normalizeGatewayStatus(await fetchGatewayStatusSnapshot());
      if (status.state === target) {
        set((state) => ({
          status,
          lifecycle: target === 'running'
            ? reconcileLifecycleWithStatus(state.lifecycle, status)
            : state.lifecycle,
        }));
        if (target === 'running') {
          scheduleLifecycleClear((partial) => set(partial));
        }
        return;
      }

      if (status.state === 'error') {
        set((state) => ({
          status,
          lifecycle:
            state.lifecycle.state === 'scheduled' || state.lifecycle.state === 'applying'
              ? {
                  ...state.lifecycle,
                  state: 'failed',
                  error: status.error,
                  at: Date.now(),
                }
              : state.lifecycle,
          lastError: status.error || 'Gateway error',
        }));
        return;
      }

      set((state) => ({
        status,
        lifecycle: reconcileLifecycleWithStatus(state.lifecycle, status),
      }));
    } catch {
      // Ignore transient host API read failures during restart; the next poll
      // usually succeeds once the main process finishes reconnecting.
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

export const useGatewayStore = create<GatewayState>((set, get) => ({
  status: {
    state: 'stopped',
    port: 18789,
  },
  lifecycle: {
    state: 'idle',
  },
  health: null,
  isInitialized: false,
  lastError: null,
  overlaySuppressed: false,

  refreshStatus: async () => {
    try {
      const status = normalizeGatewayStatus(await fetchGatewayStatusSnapshot());
      const shouldClearLifecycle = shouldPromoteLifecycleToCompleted(get().lifecycle, status);
      set((state) => ({
        status,
        isInitialized: true,
        lifecycle: reconcileLifecycleWithStatus(state.lifecycle, status),
      }));
      if (status.state === 'running' && shouldClearLifecycle) {
        scheduleLifecycleClear((partial) => set(partial));
      }
      return status;
    } catch (error) {
      set({ lastError: formatGatewayConnectError(error), isInitialized: true });
      return null;
    }
  },

  init: async () => {
    if (get().isInitialized) return;
    if (gatewayInitPromise) {
      await gatewayInitPromise;
      return;
    }

    gatewayInitPromise = (async () => {
      try {
        if (!gatewayEventUnsubscribers) {
          const unsubscribers: Array<() => void> = [];
          unsubscribers.push(subscribeHostEvent<GatewayStatus>('gateway:status', (payload) => {
            set((state) => {
              const normalizedPayload = normalizeGatewayStatus(payload);
              if (
                normalizedPayload.state === 'running' &&
                isLifecyclePending(state.lifecycle)
              ) {
                scheduleLifecycleClear(set);
                return {
                  status: normalizedPayload,
                  lifecycle: reconcileLifecycleWithStatus(state.lifecycle, normalizedPayload),
                };
              }

              if (
                normalizedPayload.state === 'error' &&
                isLifecyclePending(state.lifecycle)
              ) {
                return {
                  status: normalizedPayload,
                  lifecycle: reconcileLifecycleWithStatus(state.lifecycle, normalizedPayload),
                };
              }

              if (
                normalizedPayload.state === 'starting' ||
                normalizedPayload.state === 'reconnecting'
              ) {
                return {
                  status: normalizedPayload,
                  lifecycle: reconcileLifecycleWithStatus(state.lifecycle, normalizedPayload),
                };
              }

              return { status: normalizedPayload };
            });
          }));
          unsubscribers.push(subscribeHostEvent<Omit<GatewayLifecycle, 'state'> & { phase?: 'scheduled' | 'completed' | 'failed' }>(
            'gateway:lifecycle',
            (payload) => {
              if (lifecycleClearTimer) {
                clearTimeout(lifecycleClearTimer);
                lifecycleClearTimer = null;
              }
              const nextState = payload.phase === 'failed'
                ? 'failed'
                : payload.phase === 'completed'
                  ? 'completed'
                  : 'scheduled';
              set((state) => ({
                lifecycle: {
                  ...state.lifecycle,
                  ...payload,
                  state: nextState,
                  error: payload.phase === 'failed' ? payload.error : undefined,
                },
              }));
              if (payload.phase === 'completed') {
                scheduleLifecycleClear((partial) => set(partial), 5000);
              }
            }
          ));
          unsubscribers.push(subscribeHostEvent<{ message?: string }>('gateway:error', (payload) => {
            set({ lastError: formatGatewayConnectError(payload.message || 'Gateway error') });
          }));
          unsubscribers.push(subscribeHostEvent<{ method?: string; params?: Record<string, unknown> }>(
            'gateway:notification',
            (payload) => {
              const expectedRestartDelayMs = extractExpectedRestartDelayMs(payload);
              if (expectedRestartDelayMs !== null) {
                if (lifecycleClearTimer) {
                  clearTimeout(lifecycleClearTimer);
                  lifecycleClearTimer = null;
                }
                set((state) => ({
                  lifecycle: {
                    ...state.lifecycle,
                    action: 'restart',
                    state: 'applying',
                    delayMs: expectedRestartDelayMs,
                    at: Date.now(),
                  },
                }));
              }
              handleGatewayNotification(payload);
            },
          ));
          unsubscribers.push(subscribeHostEvent('gateway:chat-message', (payload) => {
            handleGatewayChatMessage(payload);
          }));
          gatewayEventUnsubscribers = unsubscribers;
        }

        const status = normalizeGatewayStatus(await fetchGatewayStatusSnapshot());
        const shouldClearLifecycle = shouldPromoteLifecycleToCompleted(get().lifecycle, status);
        set((state) => ({
          status,
          isInitialized: true,
          lifecycle: reconcileLifecycleWithStatus(state.lifecycle, status),
        }));
        if (status.state === 'running' && shouldClearLifecycle) {
          scheduleLifecycleClear((partial) => set(partial));
        }

        if (!gatewayStatusPollTimer) {
          gatewayStatusPollTimer = setInterval(() => {
            const isDocumentVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
            const lifecycle = get().lifecycle.state;
            const shouldPollAggressively = lifecycle === 'scheduled' || lifecycle === 'applying';
            const statusState = get().status.state;
            if (!isDocumentVisible && !shouldPollAggressively) return;
            if (statusState === 'running' && !shouldPollAggressively && isDocumentVisible) return;
            const now = Date.now();
            const minIntervalMs = shouldPollAggressively ? GATEWAY_ACTIVE_POLL_MS : GATEWAY_IDLE_POLL_MS;
            if ((now - lastPassiveGatewayStatusRefreshAt) < minIntervalMs) return;
            lastPassiveGatewayStatusRefreshAt = now;
            void get().refreshStatus();
          }, GATEWAY_ACTIVE_POLL_MS);
        }

        if (!gatewayVisibilityCleanup && typeof window !== 'undefined') {
          const refreshFromVisibility = () => {
            void get().refreshStatus();
          };
          window.addEventListener('focus', refreshFromVisibility);
          document.addEventListener('visibilitychange', refreshFromVisibility);
          gatewayVisibilityCleanup = () => {
            window.removeEventListener('focus', refreshFromVisibility);
            document.removeEventListener('visibilitychange', refreshFromVisibility);
          };
        }
      } catch (error) {
        console.error('Failed to initialize Gateway:', error);
        set({ lastError: formatGatewayConnectError(error), isInitialized: true });
      } finally {
        gatewayInitPromise = null;
      }
    })();

    await gatewayInitPromise;
  },

  start: async () => {
    try {
      await get().init();
      set({ status: { ...get().status, state: 'starting', restartExpectedMs: undefined }, lastError: null });
      const result = await invokeIpc<{ success: boolean; error?: string }>('gateway:start');
      if (!result.success) {
        const message = formatGatewayConnectError(result.error || 'Failed to start Gateway');
        set({
          status: { ...get().status, state: 'error', error: message },
          lastError: message,
        });
        return;
      }
      void reconcileGatewayStatus(set, 'running');
    } catch (error) {
      const message = formatGatewayConnectError(error);
      set({
        status: { ...get().status, state: 'error', error: message },
        lastError: message,
      });
    }
  },

  stop: async () => {
    try {
      await get().init();
      await invokeIpc<{ success: boolean; error?: string }>('gateway:stop');
      set({
        status: { ...get().status, state: 'stopped', restartExpectedMs: undefined },
        lastError: null,
        lifecycle: { state: 'idle' },
      });
      void reconcileGatewayStatus(set, 'stopped', 5000);
    } catch (error) {
      console.error('Failed to stop Gateway:', error);
      set({ lastError: formatGatewayConnectError(error) });
    }
  },

  restart: async () => {
    try {
      await get().init();
      set((state) => ({
        status: { ...state.status, state: 'starting' },
        lifecycle: {
          state: 'scheduled',
          action: 'restart',
          source: 'gateway.manualRestart',
          reason: 'gateway.manualRestart',
          at: Date.now(),
        },
        lastError: null,
      }));
      const result = await invokeIpc<{ success: boolean; error?: string; accepted?: boolean }>('gateway:restart');
      if (!result.success) {
        const message = formatGatewayConnectError(result.error || 'Failed to restart Gateway');
        set({
          status: { ...get().status, state: 'error', error: message },
          lastError: message,
        });
        return;
      }
      set((state) => ({
        lifecycle:
          state.lifecycle.state === 'scheduled'
            ? {
                ...state.lifecycle,
                state: 'applying',
              }
            : state.lifecycle,
      }));
      void reconcileGatewayStatus(set, 'running');
    } catch (error) {
      const message = formatGatewayConnectError(error);
      set({
        status: { ...get().status, state: 'error', error: message },
        lastError: message,
      });
    }
  },

  checkHealth: async () => {
    try {
      const result = await invokeIpc<{ success: boolean; ok: boolean; error?: string; uptime?: number; version?: string }>('gateway:health');
      if (!result.success) {
        const health: GatewayHealth = { ok: false, error: result.error || 'Gateway health check failed' };
        set({ health });
        return health;
      }
      const health: GatewayHealth = { ok: result.ok, error: result.error, uptime: result.uptime };
      set({ health: result });
      return health;
    } catch (error) {
      const health: GatewayHealth = { ok: false, error: String(error) };
      set({ health });
      return health;
    }
  },

  rpc: async <T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> => {
    const response = await invokeIpc<{
      success: boolean;
      result?: T;
      error?: string;
    }>('gateway:rpc', method, params, timeoutMs);
    if (!response.success) {
      throw new Error(response.error || `Gateway RPC failed: ${method}`);
    }
    return response.result as T;
  },

  setStatus: (status) => set({ status: normalizeGatewayStatus(status) }),
  setOverlaySuppressed: (overlaySuppressed) => set({ overlaySuppressed }),
  clearError: () => set({ lastError: null }),
}));
