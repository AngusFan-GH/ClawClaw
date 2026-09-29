import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { registerDesktopJsonApi } from '../src/desktop-json-api.ts'
import { registerCronTasksJsonApi } from '../src/cron-tasks.ts'

describe('Desktop JSON body limits', () => {
  it.each([undefined, 256 * 1024 * 6 + 16_384])('keeps bounded per-endpoint limits (%s)', async maxBodyBytes => {
    const routes: { path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }[] = []
    const action = vi.fn(async () => ({}))
    registerDesktopJsonApi({
      effect: (setup: () => void) => setup(), connection: { requestRejection: () => undefined },
      webServer: { port: 12345, register: (route: typeof routes[number]) => { routes.push(route) } },
    } as unknown as Context, { label: 'Test', readPath: '/read', actionPath: '/action', read: async () => ({}), action,
      ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }) })
    const send = async (content: string, origin = 'http://127.0.0.1:12345') => {
      const req = Object.assign(Readable.from([JSON.stringify({ content })]), {
        method: 'POST', headers: { host: '127.0.0.1:12345', origin, 'content-type': 'application/json' },
        socket: { remoteAddress: '127.0.0.1' },
      }) as unknown as IncomingMessage
      const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() }
      await routes[1]!.handler(req, res as unknown as ServerResponse)
      return res.statusCode
    }
    expect(await send('x'.repeat(100_000))).toBe(maxBodyBytes === undefined ? 413 : 200)
    expect(await send('\u0000'.repeat(256 * 1024))).toBe(maxBodyBytes === undefined ? 413 : 200)
    expect(await send('x'.repeat((maxBodyBytes ?? 64 * 1024) + 1))).toBe(413)
    expect(await send('x', 'https://example.com')).toBe(403)
  })
})

describe('reloadable Cron task routes', () => {
  it('stays mounted and resolves the current controller after replacement', async () => {
    const routes: { path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }[] = []
    let controller = { read: vi.fn(async () => ({ jobs: ['first'] })), action: vi.fn(async () => ({})) }
    const ctx = {
      effect: (setup: () => unknown) => setup(),
      provide: vi.fn(),
      get: (name: string) => name === 'desktopCronTasksController' ? controller : undefined,
      agents: { get: vi.fn(), create: vi.fn(), resume: vi.fn() },
      connection: { requestRejection: () => undefined },
      webServer: { port: 12345, register: (route: typeof routes[number]) => { routes.push(route); return () => {} } },
    } as unknown as Context
    registerCronTasksJsonApi(ctx)
    const request = Object.assign(Readable.from([]), {
      method: 'GET', headers: { host: '127.0.0.1:12345', referer: 'http://127.0.0.1:12345/', 'sec-fetch-site': 'same-origin' },
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage
    const responseBody = async (): Promise<string> => {
      let body = ''
      const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn((value?: string) => { body = value ?? '' }) }
      await routes[0]!.handler(request, response as unknown as ServerResponse)
      return body
    }

    expect(JSON.parse(await responseBody())).toEqual({ jobs: ['first'] })
    controller = { read: vi.fn(async () => ({ jobs: ['second'] })), action: vi.fn(async () => ({})) }
    expect(JSON.parse(await responseBody())).toEqual({ jobs: ['second'] })
    expect(routes).toHaveLength(2)
  })
})
