import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('host-events', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('subscribes through IPC for mapped host events', async () => {
    const onMock = vi.mocked(window.desktop.ipcRenderer.on);
    const unsubscribeMock = vi.fn();
    const captured: Array<(...args: unknown[]) => void> = [];
    onMock.mockImplementation((_, cb: (...args: unknown[]) => void) => {
      captured.push(cb);
      return unsubscribeMock;
    });

    const { subscribeHostEvent } = await import('@/lib/host-events');
    const handler = vi.fn();
    const unsubscribe = subscribeHostEvent('gateway:status', handler);

    expect(onMock).toHaveBeenCalledWith('gateway:status-changed', expect.any(Function));

    captured[0]({ state: 'running' });
    expect(handler).toHaveBeenCalledWith({ state: 'running' });

    unsubscribe();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('does not create an EventSource fallback for unknown events', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { subscribeHostEvent } = await import('@/lib/host-events');

    const unsubscribe = subscribeHostEvent('unknown:event', vi.fn());

    expect(warnSpy).toHaveBeenCalledWith('[host-events] no IPC mapping for event "unknown:event"');
    unsubscribe();
    warnSpy.mockRestore();
  });
});
