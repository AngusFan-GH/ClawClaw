/** Cordis Host plugin for scheduled and interactive ClawClaw updates. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { DESKTOP_UPDATE_CHECK_PATH } from './desktop-settings-contract.ts'
import { handleDesktopUpdateCheckRequest } from './desktop-settings-route.ts'
import { DESKTOP_SETTINGS_NAMESPACE, type DesktopSettings } from './index.ts'
import type {} from './runtime.ts'
import { startDesktopUpdateLifecycle } from './update-lifecycle.ts'
import { DesktopUpdateQualificationJournalManager } from './update-qualification-journal.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-updates'

/** Native adapter required for network, tray, confirmation, and installer access. */
export const inject = ['desktopRuntime', 'webServer', 'connection', 'settings']

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Scheduled update policy. */
export interface Config {
  /** Enable background checks in packaged applications. */
  enabled: boolean
  /** Delay before the first background check after plugin activation. */
  initialDelayMs: number
  /** Delay between completion of one background check and the next attempt. */
  intervalMs: number
  /** Maximum failure-backoff delay, including jitter. */
  maxBackoffMs: number
  /** Fractional random variation applied to checks after the initial delay. */
  jitter: number
  /** Maximum duration of one version request before caller-owned cancellation. */
  requestTimeoutMs: number
}

/** Validated scheduled update policy. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  initialDelayMs: z.number().step(1).min(0).max(MAX_TIMER_DELAY_MS).default(60_000),
  intervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(6 * 60 * 60 * 1000),
  maxBackoffMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(24 * 60 * 60 * 1000),
  jitter: z.number().min(0).max(1).default(0.2),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(15_000),
})

/**
 * Register effect-scoped update polling and its dynamic tray command.
 * @param ctx - Host context carrying the desktop native adapter.
 * @param config - validated polling and timeout values.
 */
export function apply(ctx: Context, config: Config): void {
  const journal = new DesktopUpdateQualificationJournalManager(
    ctx.desktopRuntime.updates.qualificationJournalDirectory,
    ctx.desktopRuntime.updates.currentVersion,
  )
  const journalEnabled = (): boolean => {
    return (ctx.settings.get(DESKTOP_SETTINGS_NAMESPACE) as DesktopSettings | undefined)
      ?.updateQualificationJournal ?? false
  }
  try {
    journal.setEnabled(journalEnabled())
  } catch (cause) {
    ctx.logger.warn(
      `dsh-plugin-desktop: update qualification journal unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  ctx.provide('desktopUpdateQualificationJournal', journal)
  ctx.on('settings/updated', (namespace, next) => {
    if (namespace === DESKTOP_SETTINGS_NAMESPACE) {
      try {
        journal.setEnabled((next as DesktopSettings).updateQualificationJournal)
      } catch (cause) {
        ctx.logger.warn(
          `dsh-plugin-desktop: update qualification journal unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
    }
  })
  ctx.effect(() => {
    const lifecycle = startDesktopUpdateLifecycle({
      adapter: ctx.desktopRuntime.updates,
      policy: config,
      locale: () => ctx.desktopRuntime.locale,
      registerTrayItem: item => ctx.desktopRuntime.registerTrayItem(item),
      journal,
    })
    const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`
    const unregister = ctx.webServer.register({
      kind: 'exact',
      path: DESKTOP_UPDATE_CHECK_PATH,
      handler: (req, res) => {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        return handleDesktopUpdateCheckRequest(
          req,
          res,
          rendererOrigin,
          () => lifecycle.checkNow(),
          (operation, cause) => {
            ctx.logger.error(
              `dsh-plugin-desktop: failed to ${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
            )
          },
        )
      },
    })
    return async () => {
      unregister()
      await lifecycle.dispose()
    }
  }, 'dsh-plugin-desktop: update polling, confirmation, and installer handoff')
}
