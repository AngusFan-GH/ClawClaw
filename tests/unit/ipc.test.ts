// @vitest-environment node
import './helpers/window-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke, parseError, IpcError, onEvent } from '@/lib/ipc';

describe('parseError', () => {
  it('extracts the stable code from a CORE error string', () => {
    const e = parseError(new Error('PROVIDER_SECRET_MISSING: API key is missing'));
    expect(e).toBeInstanceOf(IpcError);
    expect(e.code).toBe('PROVIDER_SECRET_MISSING');
    expect(e.message).toBe('API key is missing');
  });

  it('falls back to INTERNAL_ERROR for unknown errors', () => {
    const e = parseError('boom');
    expect(e.code).toBe('INTERNAL_ERROR');
    expect(e.message).toBe('boom');
  });

  it('passes through an existing IpcError', () => {
    const original = new IpcError('X', 'y');
    expect(parseError(original)).toBe(original);
  });
});

describe('invoke', () => {
  beforeEach(() => {
    window.desktop.ipcRenderer.invoke = vi.fn().mockResolvedValue('ok');
  });

  it('calls the desktop bridge with the explicit channel', async () => {
    const result = await invoke<string>('provider:list', 'default');
    expect(result).toBe('ok');
    expect(window.desktop.ipcRenderer.invoke).toHaveBeenCalledWith('provider:list', 'default');
  });

  it('wraps a rejected bridge call as an IpcError', async () => {
    window.desktop.ipcRenderer.invoke = vi.fn().mockRejectedValue(new Error('CRON_EXPRESSION_INVALID: bad'));
    await expect(invoke('cron:save', {})).rejects.toMatchObject({ code: 'CRON_EXPRESSION_INVALID' });
  });
});

describe('onEvent', () => {
  it('subscribes through the bridge', () => {
    const off = vi.fn();
    window.desktop.ipcRenderer.on = vi.fn().mockReturnValue(off);
    const unsubscribe = onEvent('core:run:event', () => undefined);
    expect(window.desktop.ipcRenderer.on).toHaveBeenCalledWith('core:run:event', expect.any(Function));
    unsubscribe();
    expect(off).toHaveBeenCalled();
  });
});
