import { describe, expect, it } from 'vitest';
import { getGatewayRecoveryPresentation } from '@/lib/gateway-recovery';

describe('getGatewayRecoveryPresentation', () => {
  it('returns reset presentation for full config rebuild', () => {
    expect(getGatewayRecoveryPresentation({
      kind: 'config-reset',
      strategy: 'reset',
    })).toEqual({
      tone: 'reset',
      strategyLabel: 'reset',
      summaryKey: 'gateway.lifecycle.recovery.resetSummary',
      nextStepKey: 'gateway.lifecycle.recovery.resetNextStep',
      badgeKey: 'gateway.lifecycle.recovery.resetBadge',
    });
  });

  it('returns preflight presentation for startup compatibility repair', () => {
    expect(getGatewayRecoveryPresentation({
      kind: 'preflight',
      topics: ['config', 'plugins'],
    })).toEqual({
      tone: 'preflight',
      strategyLabel: null,
      summaryKey: 'gateway.lifecycle.recovery.preflightSummary',
      nextStepKey: 'gateway.lifecycle.recovery.preflightNextStep',
      badgeKey: 'gateway.lifecycle.recovery.preflightBadge',
    });
  });

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
      badgeKey: 'gateway.lifecycle.recovery.repairedBadge',
    });
  });

  it('returns null when no recovery metadata exists', () => {
    expect(getGatewayRecoveryPresentation()).toBeNull();
  });
});
