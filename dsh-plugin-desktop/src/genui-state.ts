import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type DomainTableSpec } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import { GENUI_STATE_PATH, validHtmlState, type GenuiHtmlState } from './genui-state-contract.ts'

const schema = z.custom<GenuiHtmlState>(validHtmlState)
export function genuiStateDomain(profile: string) {
  return defineDomain({ name: `desktop_genui_state_${createHash('sha256').update(profile).digest('hex').slice(0, 20)}`,
    version: 1, layout: 'per-record', tables: { snippets: domainTable(schema as unknown as DomainTableSpec<string, GenuiHtmlState>['valueSchema']) } })
}
export function applyGenuiState(ctx: Context, enabled: () => boolean): void {
  ctx.inject(['storageDomain', 'profileContext', 'webServer', 'connection'], async scope => {
    const domain = await scope.storageDomain.open(genuiStateDomain(scope.profileContext.dir))
    scope.effect(() => () => domain.close(), 'desktop: GenUI durable state')
    const table = domain.table('snippets')
    registerDesktopJsonApi(scope, { label: 'GenUI state', readPath: GENUI_STATE_PATH, actionPath: `${GENUI_STATE_PATH}/action`,
      read: async () => ({ enabled: enabled() }),
      action: async value => {
        if (!enabled()) throw new Error('Visual responses are disabled')
        if (!value || typeof value !== 'object') throw new TypeError('Invalid state request')
        const v = value as Record<string, unknown>
        if (!['load', 'save', 'clear'].includes(String(v.action)) || !['sessionId', 'callId', 'path'].every(key =>
          typeof v[key] === 'string' && (v[key] as string).length > 0 && (v[key] as string).length <= 256)
          || typeof v.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.sourceHash)) throw new TypeError('Invalid state identity')
        const key = createHash('sha256').update(JSON.stringify([v.sessionId, v.callId, v.path, v.sourceHash])).digest('hex')
        if (v.action === 'load') return { state: table.get(key) ?? null }
        if (v.action === 'clear') { await table.delete(key); return { ok: true } }
        if (!validHtmlState(v.state)) throw new TypeError('Invalid or oversized presentation state')
        if (!table.get(key) && table.size >= 1000) throw new Error('Presentation state storage is full')
        await table.put(key, v.state)
        return { ok: true }
      },
    })
  })
}
