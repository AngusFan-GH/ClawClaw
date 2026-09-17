import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

const MAX_BODY_BYTES = 64 * 1024

class BodyTooLargeError extends Error {}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function finishJson(res: ServerResponse, status: number, value: object, allow?: string): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  if (allow !== undefined) res.setHeader('allow', allow)
  res.end(JSON.stringify(value))
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  if (address === '::1' || address.startsWith('127.')) return true
  return address.startsWith('::ffff:127.')
}

function isSameOriginRequest(req: IncomingMessage, expectedOrigin: string, mutating: boolean): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  let expected: URL
  try { expected = new URL(expectedOrigin) } catch { return false }
  if (req.headers.host?.toLowerCase() !== expected.host.toLowerCase()) return false
  if (req.headers.origin === expected.origin) {
    return req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin'
  }
  if (mutating || req.headers['sec-fetch-site'] !== 'same-origin' || req.headers.referer === undefined) return false
  try { return new URL(req.headers.referer).origin === expected.origin } catch { return false }
}

export interface DesktopJsonApiOptions {
  readonly label: string
  readonly readPath: string
  readonly actionPath: string
  readonly read: () => Promise<object>
  readonly action: (value: unknown) => Promise<object>
}

/** Register a loopback-only, same-origin JSON read/action pair. */
export function registerDesktopJsonApi(ctx: Context, options: DesktopJsonApiOptions): void {
  const expectedOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const register = (path: string, action: boolean): void => {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path,
      handler: async (req, res) => {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) return finishJson(res, rejection, { error: 'forbidden' })
        if (!isSameOriginRequest(req, expectedOrigin, action)) return finishJson(res, 403, { error: 'forbidden' })
        if (req.method !== (action ? 'POST' : 'GET')) {
          return finishJson(res, 405, { error: 'method not allowed' }, action ? 'POST' : 'GET')
        }
        if (action && req.headers['content-type']?.split(';', 1)[0]?.trim() !== 'application/json') {
          return finishJson(res, 415, { error: 'content type must be application/json' })
        }
        try {
          finishJson(res, 200, action ? await options.action(await readJson(req)) : await options.read())
        } catch (cause) {
          const status = cause instanceof BodyTooLargeError ? 413 : cause instanceof TypeError ? 400 : 409
          finishJson(res, status, { error: cause instanceof Error ? cause.message : `${options.label} operation failed` })
        }
      },
    }), `dsh-plugin-desktop: ${options.label} route ${path}`)
  }
  register(options.readPath, false)
  register(options.actionPath, true)
}
