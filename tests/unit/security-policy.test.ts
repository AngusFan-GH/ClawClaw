import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECURITY_POLICY,
  createSecurityRuntimeState,
  mergeManagedToolDeny,
} from '@/shared/security-policy';

describe('security policy helpers', () => {
  it('preserves unrelated deny entries when managed rules change', () => {
    const merged = mergeManagedToolDeny(
      ['browser', 'cron', 'group:runtime'],
      ['denyBrowser', 'denyRuntime'],
      ['denyWrite'],
    );

    expect(merged).toEqual(['cron', 'write', 'edit', 'apply_patch']);
  });

  it('reports extra runtime deny entries without losing managed sync state', () => {
    const runtime = createSecurityRuntimeState(
      {
        prompt: {
          ...DEFAULT_SECURITY_POLICY.prompt,
          enabled: true,
          rules: ['denyBrowser'],
        },
      },
      ['browser', 'cron'],
    );

    expect(runtime.activeRules).toEqual(['denyBrowser']);
    expect(runtime.extraToolDeny).toEqual(['cron']);
    expect(runtime.managedInSync).toBe(true);
  });
});
