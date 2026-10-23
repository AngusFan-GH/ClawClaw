/** Desktop activation of the pinned Git UI, built without install telemetry. */
import type { Context } from '@deepseek-ai/cordis'
import gitGraphClientFactory from 'clawclaw:git-graph-client'
import { installGitGraphInteractions } from './git-graph-interactions.ts'
import { installGitGraphStyles } from './git-graph-styles.ts'

declare function require(id: string): unknown

export function applyDesktopGitGraph(ctx: Context): void {
  ctx.inject(['slots', 'sessions', 'workspaces', 'connection', 'locale'], scope => {
    scope.effect(() => installGitGraphInteractions(), 'dsh-plugin-desktop: Git dialogs keyboard behavior')
    gitGraphClientFactory(require).apply(scope)
    scope.effect(() => installGitGraphStyles(), 'dsh-plugin-desktop: Git theme integration')
  })
}
