export type RuntimeApplyRequirement = 'none' | 'reload' | 'restart' | 'restart_immediate';

export type RuntimeApplyDomain = 'providers' | 'agents' | 'channels' | 'security';

export type PendingRuntimeChange = {
  id: string;
  domain: RuntimeApplyDomain;
  label: string;
  source: string;
  reason: string;
  requires: RuntimeApplyRequirement;
  createdAt: number;
  updatedAt: number;
};

export type RuntimeApplyPlanSnapshot = {
  pending: PendingRuntimeChange[];
  count: number;
  requires: RuntimeApplyRequirement;
  action: 'none' | 'reload' | 'restart';
};

export function runtimeApplyRequirementSeverity(requirement: RuntimeApplyRequirement): number {
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

export function resolveRuntimeApplyAction(
  requirement: RuntimeApplyRequirement,
): RuntimeApplyPlanSnapshot['action'] {
  if (requirement === 'reload') return 'reload';
  if (requirement === 'restart' || requirement === 'restart_immediate') return 'restart';
  return 'none';
}

export function mergeRuntimeApplyRequirement(
  left: RuntimeApplyRequirement,
  right: RuntimeApplyRequirement,
): RuntimeApplyRequirement {
  return runtimeApplyRequirementSeverity(right) >= runtimeApplyRequirementSeverity(left)
    ? right
    : left;
}
