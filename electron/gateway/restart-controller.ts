import { logger } from '../utils/logger';
import {
  getDeferredRestartAction,
  shouldDeferRestart,
  type GatewayLifecycleState,
} from './process-policy';

type RestartDeferralState = {
  state: GatewayLifecycleState;
  startLock: boolean;
};

type DeferredRestartContext = RestartDeferralState & {
  shouldReconnect: boolean;
};

export class GatewayRestartController {
  private deferredRestartPending = false;
  private deferredRestartAction: 'reload' | 'restart' | null = null;
  private restartDebounceTimer: NodeJS.Timeout | null = null;

  isRestartDeferred(context: RestartDeferralState): boolean {
    return shouldDeferRestart(context);
  }

  markDeferredRestart(
    reason: string,
    context: RestartDeferralState,
    action: 'reload' | 'restart',
  ): void {
    if (!this.deferredRestartPending) {
      logger.info(
        `Deferring Gateway restart (${reason}) until startup/reconnect settles (state=${context.state}, startLock=${context.startLock})`,
      );
    } else {
      logger.debug(
        `Gateway restart already deferred; keeping pending request (${reason}, state=${context.state}, startLock=${context.startLock})`,
      );
    }
    this.deferredRestartPending = true;
    if (this.deferredRestartAction !== 'restart') {
      this.deferredRestartAction = action;
    }
  }

  flushDeferredRestart(
    trigger: string,
    context: DeferredRestartContext,
    execute: { reload: () => void; restart: () => void },
  ): void {
    const action = getDeferredRestartAction({
      hasPendingRestart: this.deferredRestartPending,
      state: context.state,
      startLock: context.startLock,
      shouldReconnect: context.shouldReconnect,
    });

    if (action === 'none') return;
    if (action === 'wait') {
      logger.debug(
        `Deferred Gateway restart still waiting (${trigger}, state=${context.state}, startLock=${context.startLock})`,
      );
      return;
    }

    const deferredAction = this.deferredRestartAction ?? 'restart';
    this.deferredRestartPending = false;
    this.deferredRestartAction = null;
    if (action === 'drop') {
      logger.info(
        `Dropping deferred Gateway restart (${trigger}) because lifecycle already recovered (state=${context.state}, shouldReconnect=${context.shouldReconnect})`,
      );
      return;
    }

    logger.info(`Executing deferred Gateway ${deferredAction} now (${trigger})`);
    execute[deferredAction]();
  }

  debouncedRestart(delayMs: number, executeRestart: () => void): void {
    if (this.restartDebounceTimer) {
      clearTimeout(this.restartDebounceTimer);
    }
    logger.debug(`Gateway restart debounced (will fire in ${delayMs}ms)`);
    this.restartDebounceTimer = setTimeout(() => {
      this.restartDebounceTimer = null;
      executeRestart();
    }, delayMs);
  }

  clearDebounceTimer(): void {
    if (this.restartDebounceTimer) {
      clearTimeout(this.restartDebounceTimer);
      this.restartDebounceTimer = null;
    }
  }

  resetDeferredRestart(): void {
    this.deferredRestartPending = false;
    this.deferredRestartAction = null;
  }
}
