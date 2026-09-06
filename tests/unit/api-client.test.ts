import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppError,
  invokeIpc,
  invokeIpcWithRetry,
  toUserMessage,
} from '@/lib/api-client';

describe('api-client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('forwards unified channels through app:request', async () => {
    const invoke = vi.mocked(window.desktop.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({ ok: true, data: { ok: true } });

    const result = await invokeIpc<{ ok: boolean }>('settings:getAll', { a: 1 });

    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      'app:request',
      expect.objectContaining({
        module: 'settings',
        action: 'getAll',
      })
    );
  });

  it('falls back to a legacy channel when app:request is unsupported', async () => {
    const invoke = vi.mocked(window.desktop.ipcRenderer.invoke);
    invoke
      .mockRejectedValueOnce(new Error('APP_REQUEST_UNSUPPORTED:settings.getAll'))
      .mockResolvedValueOnce({ foo: 'bar' });

    const result = await invokeIpc<{ foo: string }>('settings:getAll');

    expect(result.foo).toBe('bar');
    expect(invoke).toHaveBeenNthCalledWith(2, 'settings:getAll');
  });

  it('sends tuple payload for multi-arg unified requests', async () => {
    const invoke = vi.mocked(window.desktop.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({ ok: true, data: { success: true } });

    const result = await invokeIpc<{ success: boolean }>('settings:set', 'language', 'en');

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      'app:request',
      expect.objectContaining({
        module: 'settings',
        action: 'set',
        payload: ['language', 'en'],
      })
    );
  });

  it('uses IPC directly for gateway RPC', async () => {
    const invoke = vi.mocked(window.desktop.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({ success: true, result: { rows: [] } });

    const result = await invokeIpc<{ success: boolean; result: { rows: unknown[] } }>(
      'gateway:rpc',
      'chat.history',
      {}
    );

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith('gateway:rpc', 'chat.history', {});
  });

  it('normalizes timeout errors', async () => {
    const invoke = vi.mocked(window.desktop.ipcRenderer.invoke);
    invoke.mockRejectedValueOnce(new Error('Gateway Timeout'));

    await expect(invokeIpc('gateway:status')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('retries once for retryable unified errors', async () => {
    const invoke = vi.mocked(window.desktop.ipcRenderer.invoke);
    invoke
      .mockResolvedValueOnce({ ok: false, error: { code: 'TIMEOUT', message: 'network timeout' } })
      .mockResolvedValueOnce({ ok: true, data: { success: true } });

    const result = await invokeIpcWithRetry<{ success: boolean }>('provider:list', [], 1);

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('returns user-facing messages for normalized errors', () => {
    expect(toUserMessage(new AppError('PERMISSION', 'forbidden'))).toContain('Permission denied');
    expect(toUserMessage(new AppError('AUTH_INVALID', 'Invalid Authentication'))).toContain(
      'Authentication failed'
    );
    expect(toUserMessage(new AppError('CHANNEL_UNAVAILABLE', 'Invalid IPC channel'))).toContain(
      'Service channel unavailable'
    );
  });
});
