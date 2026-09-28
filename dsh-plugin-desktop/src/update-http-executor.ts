/** Electron-native inactivity deadline for updater metadata and artifact transfers. */

import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor.js'
import type { ClientRequest, IncomingMessage } from 'electron'

export const DEFAULT_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS = 60_000

export function resolveDesktopUpdateHttpIdleTimeout(env: NodeJS.ProcessEnv): number {
  const value = Number(env.DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS
    ?? DEFAULT_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS)
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 2_147_483_647) {
    throw new Error('dsh-plugin-desktop: update HTTP idle timeout must be an integer from 1000 through 2147483647')
  }
  return value
}

/** Retain electron-updater proxy/transport behavior while bounding silent connections. */
export class DesktopUpdateHttpExecutor extends ElectronHttpExecutor {
  constructor(
    private readonly idleTimeoutMs: number,
    proxyLogin?: ConstructorParameters<typeof ElectronHttpExecutor>[0],
  ) {
    super(proxyLogin)
    if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 1_000 || idleTimeoutMs > 2_147_483_647) {
      throw new Error('dsh-plugin-desktop: update HTTP idle timeout must be an integer from 1000 through 2147483647')
    }
  }

  override addErrorAndTimeoutHandlers(request: ClientRequest, reject: (error: Error) => void): void {
    super.addErrorAndTimeoutHandlers(request, reject, this.idleTimeoutMs)
    let response: IncomingMessage | undefined
    let timer: ReturnType<typeof setTimeout>
    const stop = (): void => {
      clearTimeout(timer)
      request.off('response', onResponse)
      request.off('abort', stop)
      request.off('error', stop)
      response?.off('data', refresh)
      response?.off('end', stop)
      response?.off('error', stop)
    }
    const refresh = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        stop()
        reject(Object.assign(new Error('Desktop update connection timed out'), { code: 'ETIMEDOUT' }))
        request.abort()
      }, this.idleTimeoutMs)
    }
    const onResponse = (incoming: IncomingMessage): void => {
      response = incoming
      response.on('data', refresh)
      response.once('end', stop)
      response.once('error', stop)
      refresh()
    }
    request.once('response', onResponse)
    request.once('abort', stop)
    request.once('error', stop)
    refresh()
  }
}
