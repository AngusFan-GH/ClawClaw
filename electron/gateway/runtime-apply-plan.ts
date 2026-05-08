import type { GatewayApplyCoordinator } from './apply-coordinator';
import type { GatewayStatus } from './manager';
import {
  mergeRuntimeApplyRequirement,
  resolveRuntimeApplyAction,
  type PendingRuntimeChange,
  type RuntimeApplyDomain,
  type RuntimeApplyPlanSnapshot,
  type RuntimeApplyRequirement,
} from '../../src/shared/runtime-apply';

export type RuntimeApplyPlanRecordInput = {
  domain: RuntimeApplyDomain;
  label: string;
  source: string;
  reason?: string;
  requires: RuntimeApplyRequirement;
};

export type RuntimeApplyResult = {
  success: boolean;
  snapshot: RuntimeApplyPlanSnapshot;
  applied: {
    action: RuntimeApplyPlanSnapshot['action'];
    triggered: boolean;
    accepted: boolean;
    deferred?: boolean;
    reason?: string;
  };
};

export class RuntimeApplyPlan {
  private readonly pending = new Map<string, PendingRuntimeChange>();

  constructor(
    private readonly deps: {
      gatewayApplyCoordinator: GatewayApplyCoordinator;
      getGatewayStatus?: () => GatewayStatus;
      beforeApply?: (snapshot: RuntimeApplyPlanSnapshot) => Promise<void>;
      beforeDiscard?: (snapshot: RuntimeApplyPlanSnapshot) => Promise<void>;
      afterApply?: (snapshot: RuntimeApplyPlanSnapshot) => Promise<void>;
    },
  ) {}

  record(input: RuntimeApplyPlanRecordInput): RuntimeApplyPlanSnapshot {
    if (input.requires === 'none') {
      return this.snapshot();
    }

    const now = Date.now();
    const existing = this.pending.get(input.source);
    this.pending.set(input.source, {
      id: input.source,
      domain: input.domain,
      label: input.label,
      source: input.source,
      reason: input.reason ?? input.source,
      requires: existing
        ? mergeRuntimeApplyRequirement(existing.requires, input.requires)
        : input.requires,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    return this.snapshot();
  }

  snapshot(): RuntimeApplyPlanSnapshot {
    const pending = Array.from(this.pending.values()).sort((left, right) => (
      left.createdAt - right.createdAt || left.id.localeCompare(right.id)
    ));
    const requires = pending.reduce<RuntimeApplyRequirement>(
      (current, change) => mergeRuntimeApplyRequirement(current, change.requires),
      'none',
    );
    return {
      pending,
      count: pending.length,
      requires,
      action: resolveRuntimeApplyAction(requires),
    };
  }

  async discard(): Promise<RuntimeApplyPlanSnapshot> {
    const before = this.snapshot();
    if (before.count === 0) {
      return before;
    }
    if (this.deps.beforeDiscard) {
      await this.deps.beforeDiscard(before);
    }
    this.pending.clear();
    return this.snapshot();
  }

  async apply(): Promise<RuntimeApplyResult> {
    const before = this.snapshot();
    if (before.action === 'none') {
      return {
        success: true,
        snapshot: before,
        applied: {
          action: 'none',
          triggered: false,
          accepted: false,
        },
      };
    }

    const gatewayStatus = this.deps.getGatewayStatus?.();
    if (gatewayStatus && gatewayStatus.state !== 'running') {
      return {
        success: true,
        snapshot: before,
        applied: {
          action: before.action,
          triggered: false,
          accepted: false,
          deferred: true,
          reason: `gateway:${gatewayStatus.state}`,
        },
      };
    }

    if (this.deps.beforeApply) {
      await this.deps.beforeApply(before);
    }

    const result = await this.deps.gatewayApplyCoordinator.applyNow({
      source: 'runtime.applyPlan',
      reason: before.pending.map((change) => change.reason).join(',') || 'runtime.applyPlan',
      requires: before.requires,
      skipIfStopped: true,
    });

    this.pending.clear();
    if (this.deps.afterApply) {
      await this.deps.afterApply(before);
    }
    return {
      success: true,
      snapshot: this.snapshot(),
      applied: {
        action: before.action,
        triggered: result.triggered,
        accepted: result.accepted,
      },
    };
  }
}
