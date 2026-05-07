import type { GatewayStatus } from './manager';

export type GatewayApplyRequirement = 'none' | 'reload' | 'restart' | 'restart_immediate';
export type GatewayApplyAction = 'reload' | 'restart';

export interface GatewayApplyIntent {
  source: string;
  reason: string;
  requires: GatewayApplyRequirement;
  delayMs?: number;
  skipIfStopped?: boolean;
}

type GatewayLifecycleEmitter = (payload: {
  phase: 'scheduled';
  action: GatewayApplyAction;
  source: string;
  reason: string;
  delayMs?: number;
}) => void;

type GatewayRefreshExecutor = (
  action: GatewayApplyAction,
  source: string,
  reason: string,
  options: {
    skipIfStopped?: boolean;
    suppressScheduledEvent?: boolean;
  },
) => Promise<{ triggered: boolean; accepted: boolean }>;

type PendingApplyTask = {
  intents: GatewayApplyIntent[];
  action: GatewayApplyAction;
  source: string;
  reason: string;
  delayMs: number;
  skipIfStopped: boolean;
};

const DEFAULT_RELOAD_DELAY_MS = 1500;
const DEFAULT_RESTART_DELAY_MS = 5000;
const IN_FLIGHT_APPLY_WAIT_TIMEOUT_MS = 90_000;

async function waitForInFlightApply(inFlight: Promise<void>): Promise<void> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      inFlight,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for the current Gateway apply operation to finish'));
        }, IN_FLIGHT_APPLY_WAIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function requirementSeverity(requirement: GatewayApplyRequirement): number {
  switch (requirement) {
    case 'none':
      return 0;
    case 'reload':
      return 1;
    case 'restart':
      return 2;
    case 'restart_immediate':
      return 3;
    default:
      return 0;
  }
}

function resolveAction(requirement: GatewayApplyRequirement): GatewayApplyAction | null {
  if (requirement === 'reload') return 'reload';
  if (requirement === 'restart' || requirement === 'restart_immediate') return 'restart';
  return null;
}

function resolveDelayMs(intent: GatewayApplyIntent): number {
  if (typeof intent.delayMs === 'number' && Number.isFinite(intent.delayMs) && intent.delayMs >= 0) {
    return Math.max(0, Math.floor(intent.delayMs));
  }
  if (intent.requires === 'restart_immediate') {
    return 0;
  }
  return intent.requires === 'reload' ? DEFAULT_RELOAD_DELAY_MS : DEFAULT_RESTART_DELAY_MS;
}

function mergeTasks(existing: PendingApplyTask | null, intent: GatewayApplyIntent): PendingApplyTask {
  const action = resolveAction(intent.requires) ?? 'reload';
  const delayMs = resolveDelayMs(intent);
  const skipIfStopped = intent.skipIfStopped !== false;

  if (!existing) {
    return {
      intents: [intent],
      action,
      source: intent.source,
      reason: intent.reason,
      delayMs,
      skipIfStopped,
    };
  }

  const existingSeverity = Math.max(...existing.intents.map((item) => requirementSeverity(item.requires)));
  const nextSeverity = requirementSeverity(intent.requires);
  const useIncomingAction = nextSeverity >= existingSeverity;

  return {
    intents: [...existing.intents, intent],
    action: useIncomingAction ? action : existing.action,
    source: intent.source,
    reason: intent.reason,
    delayMs: Math.min(existing.delayMs, delayMs),
    skipIfStopped: existing.skipIfStopped && skipIfStopped,
  };
}

export class GatewayApplyCoordinator {
  private pendingTask: PendingApplyTask | null = null;
  private pendingTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly deps: {
      getGatewayStatus: () => GatewayStatus;
      emitLifecycle: GatewayLifecycleEmitter;
      executeRefresh: GatewayRefreshExecutor;
    },
  ) {}

  enqueue(intent: GatewayApplyIntent): { accepted: boolean; queued: boolean } {
    const action = resolveAction(intent.requires);
    if (!action) {
      return { accepted: false, queued: false };
    }

    if ((intent.skipIfStopped ?? true) && this.deps.getGatewayStatus().state === 'stopped') {
      return { accepted: false, queued: false };
    }

    this.pendingTask = mergeTasks(this.pendingTask, intent);
    this.schedulePendingTask();
    return { accepted: true, queued: true };
  }

  async applyNow(intent: GatewayApplyIntent): Promise<{ triggered: boolean; accepted: boolean }> {
    const action = resolveAction(intent.requires);
    if (!action) {
      return { triggered: false, accepted: false };
    }

    if ((intent.skipIfStopped ?? true) && this.deps.getGatewayStatus().state === 'stopped') {
      return { triggered: false, accepted: false };
    }

    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingTask = null;

    if (this.inFlight) {
      await waitForInFlightApply(this.inFlight);
    }

    return await this.executeTask({
      intents: [intent],
      action,
      source: intent.source,
      reason: intent.reason,
      delayMs: 0,
      skipIfStopped: intent.skipIfStopped !== false,
    });
  }

  private schedulePendingTask(): void {
    const task = this.pendingTask;
    if (!task) return;

    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }

    this.deps.emitLifecycle({
      phase: 'scheduled',
      action: task.action,
      source: task.source,
      reason: task.reason,
      delayMs: task.delayMs,
    });

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.flushPendingTask();
    }, task.delayMs);
  }

  private async flushPendingTask(): Promise<void> {
    if (this.inFlight) {
      return;
    }

    const task = this.pendingTask;
    if (!task) {
      return;
    }

    this.pendingTask = null;

    this.inFlight = (async () => {
      await this.executeTask(task);
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
      if (this.pendingTask) {
        this.schedulePendingTask();
      }
    }
  }

  private async executeTask(task: PendingApplyTask): Promise<{ triggered: boolean; accepted: boolean }> {
    return await this.deps.executeRefresh(task.action, task.source, task.reason, {
      skipIfStopped: task.skipIfStopped,
      suppressScheduledEvent: true,
    });
  }
}
