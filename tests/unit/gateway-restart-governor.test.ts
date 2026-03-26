import { describe, expect, it } from 'vitest';
import { GatewayRestartGovernor } from '@electron/gateway/restart-governor';

describe('gateway restart governor', () => {
  it('enforces cooldown between consecutive restarts', () => {
    const governor = new GatewayRestartGovernor({
      baseCooldownMs: 1000,
      maxCooldownMs: 4000,
    });

    expect(governor.decide(100)).toEqual({ allow: true });
    governor.recordExecuted(100);

    const decision = governor.decide(200);
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reason).toBe('cooldown_active');
      expect(decision.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('opens the circuit when restart budget is exceeded', () => {
    const governor = new GatewayRestartGovernor({
      maxRestartsPerWindow: 2,
      windowMs: 10000,
      circuitOpenMs: 5000,
    });

    expect(governor.decide(0)).toEqual({ allow: true });
    governor.recordExecuted(0);
    governor.onRunning(0);

    expect(governor.decide(3000)).toEqual({ allow: true });
    governor.recordExecuted(3000);
    governor.onRunning(3000);

    const decision = governor.decide(4000);
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reason).toBe('budget_exceeded');
      expect(decision.retryAfterMs).toBe(5000);
    }
  });
});
