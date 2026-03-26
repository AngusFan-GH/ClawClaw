import type { HostApiContext } from './context';
import { emitGatewayLifecycleEvent, type GatewayLifecycleAction } from './gateway-lifecycle';

type GatewayRefreshOptions = {
  action: GatewayLifecycleAction;
  source: string;
  reason: string;
  delayMs?: number;
  mode?: 'debounced' | 'immediate';
  strategy?: 'auto' | 'stop-start';
  awaitCompletion?: boolean;
  skipIfStopped?: boolean;
};

function shouldSkipRefresh(ctx: HostApiContext, options: GatewayRefreshOptions): boolean {
  return (options.skipIfStopped ?? true) && ctx.gatewayManager.getStatus().state === 'stopped';
}

async function executeGatewayRefresh(ctx: HostApiContext, options: GatewayRefreshOptions): Promise<void> {
  if (options.action === 'reload') {
    if (options.mode === 'debounced') {
      ctx.gatewayManager.debouncedReload(options.delayMs);
      return;
    }
    await ctx.gatewayManager.reload();
    return;
  }

  if (options.mode === 'debounced') {
    ctx.gatewayManager.debouncedRestart(options.delayMs);
    return;
  }
  await ctx.gatewayManager.restart({ strategy: options.strategy ?? 'auto' });
}

export async function runGatewayRefresh(
  ctx: HostApiContext,
  options: GatewayRefreshOptions,
): Promise<{ triggered: boolean; accepted: boolean }> {
  if (shouldSkipRefresh(ctx, options)) {
    return { triggered: false, accepted: false };
  }

  emitGatewayLifecycleEvent(ctx, {
    phase: 'scheduled',
    action: options.action,
    source: options.source,
    reason: options.reason,
    delayMs: options.delayMs,
  });

  if (options.awaitCompletion === false) {
    void executeGatewayRefresh(ctx, options).catch((error) => {
      emitGatewayLifecycleEvent(ctx, {
        phase: 'failed',
        action: options.action,
        source: options.source,
        reason: options.reason,
        error: String(error),
      });
    });
    return { triggered: true, accepted: true };
  }

  try {
    await executeGatewayRefresh(ctx, options);
    return { triggered: true, accepted: true };
  } catch (error) {
    emitGatewayLifecycleEvent(ctx, {
      phase: 'failed',
      action: options.action,
      source: options.source,
      reason: options.reason,
      error: String(error),
    });
    throw error;
  }
}
