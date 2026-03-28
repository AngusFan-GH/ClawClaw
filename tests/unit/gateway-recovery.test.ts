import { describe, expect, it } from 'vitest';
import { getGatewayRecoveryPresentation } from '@/lib/gateway-recovery';

describe('getGatewayRecoveryPresentation', () => {
  it('returns repaired presentation for conservative config repair', () => {
    expect(getGatewayRecoveryPresentation({
      kind: 'config-repaired',
      strategy: 'normalize',
      backupPath: '/tmp/openclaw.json.repaired-1.bak',
    })).toEqual({
      tone: 'repaired',
      strategyLabel: 'normalize',
      summaryKey: 'gateway.lifecycle.recovery.repairedSummary',
      nextStepKey: 'gateway.lifecycle.recovery.repairedNextStep',
    });
  });

  it('returns reset presentation for full config rebuild', () => {
    expect(getGatewayRecoveryPresentation({
      kind: 'config-reset',
      strategy: 'reset',
    })).toEqual({
      tone: 'reset',
      strategyLabel: 'reset',
      summaryKey: 'gateway.lifecycle.recovery.resetSummary',
      nextStepKey: 'gateway.lifecycle.recovery.resetNextStep',
    });
  });

  it('returns null when no recovery metadata exists', () => {
    expect(getGatewayRecoveryPresentation()).toBeNull();
  });
});
