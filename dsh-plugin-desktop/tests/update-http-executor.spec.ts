import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientRequest } from 'electron'
import {
  DesktopUpdateHttpExecutor,
  resolveDesktopUpdateHttpIdleTimeout,
} from '../src/update-http-executor.ts'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function fixture() {
  const request = Object.assign(new EventEmitter(), {
    abort: vi.fn(() => { request.emit('abort') }),
  })
  const reject = vi.fn()
  new DesktopUpdateHttpExecutor(1_000)
    .addErrorAndTimeoutHandlers(request as unknown as ClientRequest, reject)
  return { request, reject }
}

describe('Electron updater inactivity deadline', () => {
  it('aborts a request that never receives response headers', async () => {
    const { request, reject } = fixture()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'ETIMEDOUT' }))
    expect(request.abort).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refreshes the deadline on bytes without timing out an active download', async () => {
    const { request, reject } = fixture()
    const response = new EventEmitter()
    request.emit('response', response)
    for (let index = 0; index < 4; index += 1) {
      await vi.advanceTimersByTimeAsync(900)
      response.emit('data', Buffer.from('data'))
    }
    expect(reject).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reject).toHaveBeenCalledOnce()
    expect(response.listenerCount('data')).toBe(0)
  })

  it.each(['abort', 'error'])('removes the deadline on request %s', async (event) => {
    const { request, reject } = fixture()
    request.emit(event, new Error('transport failure'))
    const rejectionCount = reject.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(request.abort).not.toHaveBeenCalled()
    expect(reject).toHaveBeenCalledTimes(rejectionCount)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops the deadline after the response ends', async () => {
    const { request, reject } = fixture()
    const response = new EventEmitter()
    request.emit('response', response)
    response.emit('end')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reject).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('validates constructor and environment configuration', () => {
    expect(resolveDesktopUpdateHttpIdleTimeout({})).toBe(60_000)
    expect(resolveDesktopUpdateHttpIdleTimeout({ DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS: '2500' }))
      .toBe(2_500)
    expect(() => resolveDesktopUpdateHttpIdleTimeout({ DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS: '999' }))
      .toThrow('idle timeout')
    expect(() => new DesktopUpdateHttpExecutor(Number.NaN)).toThrow('idle timeout')
  })
})
