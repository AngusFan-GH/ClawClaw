import { describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { buildGatewayConnectFrame, probeGatewayReady, waitForGatewayReady } from '../../electron/gateway/ws-client';

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

describe('waitForGatewayReady', () => {
  it('fails immediately when the child exited by signal before readiness', async () => {
    await expect(
      waitForGatewayReady({
        port: 18789,
        getProcessExitCode: () => 'SIGTERM',
        retries: 1,
        intervalMs: 1,
      }),
    ).rejects.toThrow('Gateway process exited before becoming ready (status=SIGTERM)');
  });

  it('times out with a readiness-focused startup error', async () => {
    vi.useFakeTimers();
    const assertion = expect(waitForGatewayReady({
      port: 9,
      getProcessExitCode: () => null,
      probeReady: async () => false,
      timeoutMs: 20,
      intervalMs: 5,
    })).rejects.toThrow('Gateway did not become ready on port 9 within 20ms');

    await vi.advanceTimersByTimeAsync(40);
    await assertion;
    vi.useRealTimers();
  });
});

describe('probeGatewayReady', () => {
  it('uses the Gateway /readyz probe instead of treating an open port as ready', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/readyz') {
        res.writeHead(503);
        res.end();
        return;
      }
      res.writeHead(200);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP test server address');
      }
      await expect(probeGatewayReady(address.port)).resolves.toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
