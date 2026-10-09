/** Generation-scoped capability separating Electron from ordinary browsers. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

/** Header attached only by the Electron renderer's native network session. */
export const DESKTOP_RENDERER_ACCESS_HEADER = 'x-dsh-desktop-renderer'

const ACCESS_TOKEN_BYTES = 32
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u
/** Header value retained only in main-process and Host-generation memory. */
export interface DesktopRendererAccessHeader {
  readonly name: typeof DESKTOP_RENDERER_ACCESS_HEADER
  readonly value: string
}

/** Browser-access policy fixed for one Desktop Host generation. */
export interface DesktopBrowserAccess {
  /** Ephemeral capability proving that a request came from the Electron renderer. */
  readonly rendererHeader: DesktopRendererAccessHeader
}

/** Request classes understood by the Desktop-owned WebServer gate. */
export type DesktopBrowserAccessDecision = 'renderer' | 'denied'

/** Create one unpredictable renderer capability for a Desktop Host generation. */
export function createDesktopBrowserAccess(
  token: string = randomBytes(ACCESS_TOKEN_BYTES).toString('base64url'),
): DesktopBrowserAccess {
  if (!ACCESS_TOKEN_PATTERN.test(token)) {
    throw new TypeError('dsh-plugin-desktop: renderer access token must be 32 base64url bytes')
  }
  return Object.freeze({
    rendererHeader: Object.freeze({
      name: DESKTOP_RENDERER_ACCESS_HEADER,
      value: token,
    }),
  })
}

function exactHeaderValue(headers: IncomingHttpHeaders): string | undefined {
  const value = headers[DESKTOP_RENDERER_ACCESS_HEADER]
  return typeof value === 'string' ? value : undefined
}

function sameToken(actual: string | undefined, expected: string): boolean {
  if (actual === undefined || !ACCESS_TOKEN_PATTERN.test(actual) || actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

/** Classify one HTTP or upgrade request without exposing the renderer token. */
export function decideDesktopBrowserAccess(
  access: DesktopBrowserAccess,
  request: { readonly headers: IncomingHttpHeaders; readonly url?: string | undefined },
): DesktopBrowserAccessDecision {
  if (sameToken(exactHeaderValue(request.headers), access.rendererHeader.value)) return 'renderer'
  return 'denied'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Launcher-owned request gate present only in a Desktop Host generation. */
    desktopBrowserAccess: DesktopBrowserAccess
  }
}
