import { describe, expect, it, vi } from 'vitest';
import { GatewayApplyCoordinator } from '@backend/gateway/apply-coordinator';

describe('GatewayApplyCoordinator', () => {
  it('fails applyNow instead of waiting forever behind a stuck apply', async () => {
    vi.useFakeTimers();

    const coordinator = new GatewayApplyCoordinator({
      getGatewayStatus: () => ({ state: 'running', port: 18789 }),
      emitLifecycle: vi.fn(),
      executeRefresh: vi.fn(
        () => new Promise<{ triggered: boolean; accepted: boolean }>(() => {}),
      ),
    });

    coordinator.enqueue({
      source: 'test.pending',
      reason: 'test.pending',
      requires: 'restart',
      delayMs: 0,
    });
    await vi.runOnlyPendingTimersAsync();

    const applyNow = coordinator.applyNow({
      source: 'test.immediate',
      reason: 'test.immediate',
      requires: 'restart_immediate',
      skipIfStopped: false,
    });

    const expectation = expect(applyNow).rejects.toThrow(
      'Timed out waiting for the current Gateway apply operation to finish',
    );

    await vi.advanceTimersByTimeAsync(90_000);
    await expectation;

    vi.useRealTimers();
  });
});
