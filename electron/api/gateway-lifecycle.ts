import type { HostApiContext } from './context';

export type GatewayLifecycleAction = 'restart' | 'reload';

export interface GatewayLifecycleEventPayload {
  phase: 'scheduled' | 'failed';
  action: GatewayLifecycleAction;
  source: string;
  reason: string;
  delayMs?: number;
  error?: string;
  at: number;
}

export function emitGatewayLifecycleEvent(
  ctx: HostApiContext,
  payload: Omit<GatewayLifecycleEventPayload, 'at'>,
): void {
  const event: GatewayLifecycleEventPayload = {
    ...payload,
    at: Date.now(),
  };
  ctx.eventBus.emit('gateway:lifecycle', event);
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send('gateway:lifecycle-changed', event);
  }
}
