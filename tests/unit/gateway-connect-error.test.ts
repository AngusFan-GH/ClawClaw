import { describe, expect, it } from 'vitest';
import { formatGatewayConnectError, resolveGatewayErrorDetailCode } from '../../src/lib/gateway-connect-error';

describe('gateway connect error formatting', () => {
  it('formats known gateway auth detail codes', () => {
    expect(
      formatGatewayConnectError({
        message: 'request failed',
        details: { code: 'PAIRING_REQUIRED' },
      }),
    ).toBe('Gateway pairing required');

    expect(
      formatGatewayConnectError({
        message: 'request failed',
        details: { code: 'AUTH_TOKEN_MISMATCH' },
      }),
    ).toBe('Gateway token mismatch');
  });

  it('extracts gateway detail codes', () => {
    expect(resolveGatewayErrorDetailCode({ details: { code: 'AUTH_TOKEN_MISSING' } })).toBe(
      'AUTH_TOKEN_MISSING',
    );
    expect(resolveGatewayErrorDetailCode({ details: null })).toBeNull();
  });
});
