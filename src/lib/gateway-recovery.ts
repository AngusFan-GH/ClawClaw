import type { GatewayConfigRecovery } from '@/types/gateway';

export interface GatewayRecoveryPresentation {
  tone: 'repaired' | 'reset';
  strategyLabel: string | null;
  summaryKey: string;
  nextStepKey: string;
}

export function getGatewayRecoveryPresentation(
  recovery?: GatewayConfigRecovery,
): GatewayRecoveryPresentation | null {
  if (!recovery) return null;

  const strategyLabel = recovery.strategy === 'normalize'
    ? 'normalize'
    : recovery.strategy === 'trim-root-object'
      ? 'trim-root-object'
      : recovery.strategy === 'reset'
        ? 'reset'
        : null;

  if (recovery.kind === 'config-repaired') {
    return {
      tone: 'repaired',
      strategyLabel,
      summaryKey: 'gateway.lifecycle.recovery.repairedSummary',
      nextStepKey: 'gateway.lifecycle.recovery.repairedNextStep',
    };
  }

  return {
    tone: 'reset',
    strategyLabel,
    summaryKey: 'gateway.lifecycle.recovery.resetSummary',
    nextStepKey: 'gateway.lifecycle.recovery.resetNextStep',
  };
}
