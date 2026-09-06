// @vitest-environment node
import './helpers/window-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '@/lib/api';

describe('renderer api surface', () => {
  beforeEach(() => {
    window.desktop.ipcRenderer.invoke = vi.fn(async (channel: string) => {
      if (channel.endsWith(':list') || channel.includes('list') || channel === 'core:conversation:list') return [];
      if (channel === 'app:readiness') return { defaultConfigured: true };
      return {};
    });
  });

  it('addresses only ClawCore IPC channels (no gateway/host-api)', async () => {
    await api.providers();
    await api.skills();
    await api.channels();
    await api.cron();
    await api.send({ message: 'hi' });
    await api.events('run-1', 0);
    const channels = vi.mocked(window.desktop.ipcRenderer.invoke).mock.calls.map((c) => String(c[0]));
    expect(channels).toContain('provider:list');
    expect(channels).toContain('core:chat:send');
    expect(channels).toContain('core:run:getEvents');
    for (const channel of channels) {
      expect(channel).not.toMatch(/gateway|hostapi|18789/i);
    }
  });

  it('sends a normalized chat payload', async () => {
    await api.send({ workspaceId: 'default', conversationId: 'c1', message: 'hi', idempotencyKey: 'k' });
    const [channel, payload] = vi.mocked(window.desktop.ipcRenderer.invoke).mock.calls[0];
    expect(channel).toBe('core:chat:send');
    expect(payload).toMatchObject({ conversationId: 'c1', message: 'hi' });
  });
});
