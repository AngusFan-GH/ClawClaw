import { describe, expect, it } from 'vitest';
import { buildGatewayConnectFrame } from '../../electron/gateway/ws-client';

describe('buildGatewayConnectFrame', () => {
  it('uses backend gateway client semantics aligned with openclaw', () => {
    const { frame } = buildGatewayConnectFrame({
      challengeNonce: 'nonce-1',
      token: 'gateway-token',
      deviceIdentity: null,
      platform: 'darwin',
      clientVersion: '0.1.12',
    });

    expect(frame).toMatchObject({
      type: 'req',
      method: 'connect',
      params: {
        role: 'operator',
        caps: ['tool-events'],
        auth: { token: 'gateway-token' },
        client: {
          id: 'gateway-client',
          mode: 'backend',
          version: '0.1.12',
          platform: 'darwin',
        },
        scopes: [
          'operator.admin',
          'operator.read',
          'operator.write',
          'operator.approvals',
          'operator.pairing',
        ],
      },
    });
  });
});
