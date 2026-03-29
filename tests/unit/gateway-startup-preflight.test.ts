import { describe, expect, it, vi } from 'vitest';
import { runGatewayStartupPreflight } from '@electron/gateway/startup-preflight';

describe('gateway startup preflight runner', () => {
  it('runs steps in order and continues after a failed step', async () => {
    const calls: string[] = [];
    const onStepError = vi.fn();

    const result = await runGatewayStartupPreflight({
      steps: [
        {
          id: 'one',
          label: 'stepOne',
          run: async () => {
            calls.push('one');
          },
        },
        {
          id: 'two',
          label: 'stepTwo',
          run: async () => {
            calls.push('two');
            throw new Error('broken');
          },
        },
        {
          id: 'three',
          label: 'stepThree',
          run: async () => {
            calls.push('three');
          },
        },
      ],
      onStepError,
    });

    expect(calls).toEqual(['one', 'two', 'three']);
    expect(result.completedStepIds).toEqual(['one', 'three']);
    expect(result.failedStepIds).toEqual(['two']);
    expect(onStepError).toHaveBeenCalledTimes(1);
    expect(onStepError.mock.calls[0]?.[0]).toMatchObject({ id: 'two', label: 'stepTwo' });
  });
});
