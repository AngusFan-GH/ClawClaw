/** Pinned Git Host implementation with the existing Desktop connection gate. */
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply as applyGitGraph, inject as gitInject, type Config as GitConfig } from '@linxin666/dsh-client-ui-git-graph'

export { Config } from '@linxin666/dsh-client-ui-git-graph'
export const inject = [...gitInject, 'connection']

export function apply(ctx: Context, config?: GitConfig): void {
  const webServer = new Proxy(ctx.webServer, {
    get(target, property) {
      if (property === 'register') {
        return (route: WebRoute) => target.register({
          ...route,
          handler: async (request, response) => {
            const rejection = ctx.connection.requestRejection(request)
            if (rejection !== undefined) {
              response.statusCode = rejection
              response.setHeader('content-type', 'application/json; charset=utf-8')
              response.setHeader('cache-control', 'no-store')
              response.end(JSON.stringify({ ok: false, error: { code: 'internal', message: 'forbidden' } }))
              return
            }
            await route.handler(request, response)
          },
        })
      }
      const value = Reflect.get(target, property) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const scope = new Proxy(ctx, {
    get(target, property, receiver) {
      return property === 'webServer' ? webServer : Reflect.get(target, property, receiver)
    },
  })
  applyGitGraph(scope, config)
}
