import type { DesktopMcpDiagnosticView, DesktopMcpServerView } from './mcp-contract.ts'

export interface DesktopMcpDiagnosticInput {
  readonly enabled: boolean
  readonly state: DesktopMcpServerView['state']
  readonly credentialsReady: boolean
  readonly authorizationRequired?: boolean
  readonly toolCount: number
  readonly checkedAt?: number
  readonly lastSuccessfulAt?: number
}

/** Convert runtime details into a stable, presentation-neutral diagnostic stage. */
export function deriveMcpDiagnostic(input: DesktopMcpDiagnosticInput): DesktopMcpDiagnosticView {
  const timing = {
    ...(input.checkedAt === undefined ? {} : { checkedAt: input.checkedAt }),
    ...(input.lastSuccessfulAt === undefined ? {} : { lastSuccessfulAt: input.lastSuccessfulAt }),
  }
  if (input.state === 'error' && !input.credentialsReady) {
    if (input.authorizationRequired === true) return Object.freeze({ code: 'authorization-required', stage: 'authorization', ...timing })
    return Object.freeze({ code: 'credentials-missing', stage: 'credentials', ...timing })
  }
  if (input.state === 'error') return Object.freeze({ code: 'connection-failed', stage: 'connection', ...timing })
  if (!input.enabled || input.state === 'disabled') return Object.freeze({ code: 'disabled', stage: 'configuration', ...timing })
  if (input.state === 'starting') return Object.freeze({ code: 'connecting', stage: 'connection', ...timing })
  if (input.toolCount === 0) return Object.freeze({ code: 'tools-pending', stage: 'discovery', ...timing })
  return Object.freeze({ code: 'ready', stage: 'ready', ...timing })
}
