import { describe, expect, it, vi } from 'vitest';
import { RuntimeApplyPlan } from '@electron/gateway/runtime-apply-plan';

function createPlan() {
  const applyNow = vi.fn(async () => ({ triggered: true, accepted: true }));
  const plan = new RuntimeApplyPlan({
    gatewayApplyCoordinator: {
      applyNow,
    } as unknown as ConstructorParameters<typeof RuntimeApplyPlan>[0]['gatewayApplyCoordinator'],
  });
  return { plan, applyNow };
}

function createPlanWithGatewayState(state: 'stopped' | 'starting' | 'running' | 'error') {
  const applyNow = vi.fn(async () => ({ triggered: true, accepted: true }));
  const plan = new RuntimeApplyPlan({
    gatewayApplyCoordinator: {
      applyNow,
    } as unknown as ConstructorParameters<typeof RuntimeApplyPlan>[0]['gatewayApplyCoordinator'],
    getGatewayStatus: () => ({ state, port: 18789 }),
  });
  return { plan, applyNow };
}

describe('RuntimeApplyPlan', () => {
  it('merges pending changes and applies the highest requirement once', async () => {
    const { plan, applyNow } = createPlan();

    plan.record({
      domain: 'providers',
      label: '模型配置',
      source: 'provider.save',
      requires: 'reload',
    });
    plan.record({
      domain: 'channels',
      label: '连接配置',
      source: 'channel.save',
      requires: 'restart',
    });

    expect(plan.snapshot()).toMatchObject({
      count: 2,
      requires: 'restart',
      action: 'restart',
    });

    const result = await plan.apply();

    expect(applyNow).toHaveBeenCalledTimes(1);
    expect(applyNow).toHaveBeenCalledWith(expect.objectContaining({
      requires: 'restart',
      source: 'runtime.applyPlan',
    }));
    expect(result.snapshot.count).toBe(0);
  });

  it('keeps one pending entry per source and preserves the stronger requirement', () => {
    const { plan } = createPlan();

    plan.record({
      domain: 'agents',
      label: '分身配置',
      source: 'agent.update',
      requires: 'reload',
    });
    plan.record({
      domain: 'agents',
      label: '分身配置',
      source: 'agent.update',
      requires: 'restart',
    });

    const snapshot = plan.snapshot();
    expect(snapshot.count).toBe(1);
    expect(snapshot.requires).toBe('restart');
    expect(snapshot.pending[0]?.requires).toBe('restart');
  });

  it('keeps pending changes when the gateway is not running', async () => {
    const { plan, applyNow } = createPlanWithGatewayState('error');

    plan.record({
      domain: 'providers',
      label: '模型配置',
      source: 'provider.save',
      requires: 'reload',
    });

    const result = await plan.apply();

    expect(applyNow).not.toHaveBeenCalled();
    expect(result.applied).toMatchObject({
      action: 'reload',
      triggered: false,
      accepted: false,
      deferred: true,
      reason: 'gateway:error',
    });
    expect(result.snapshot.count).toBe(1);
    expect(plan.snapshot().count).toBe(1);
  });
});
