import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Shared across the three features; abort alone does not release physical work. */
const busy = new WeakSet<object>()
export async function exclusiveInputCall<T>(owner: object, signal: AbortSignal, work: () => Promise<T>): Promise<T | undefined> {
  signal.throwIfAborted()
  if (busy.has(owner)) return undefined
  busy.add(owner)
  try { return await work() }
  finally { busy.delete(owner) }
}

/** History is delivered before its existing background activation finishes.
 * Observe that activation without creating/resuming an Agent or polling. */
export function waitForInputAgent(ctx: Pick<Context, 'agents' | 'on'>, sessionId: SessionId, signal: AbortSignal): Promise<Agent | undefined> {
  if (signal.aborted) return Promise.resolve(undefined)
  const current = ctx.agents.get(sessionId)
  if (current !== undefined) return Promise.resolve(current)
  return new Promise(resolve => {
    let settled = false
    let stop: (() => void) | undefined
    const finish = (agent?: Agent): void => {
      if (settled) return
      settled = true; stop?.(); signal.removeEventListener('abort', cancel); resolve(agent)
    }
    const cancel = (): void => finish()
    stop = ctx.on('agent/created', ({ agent }) => { if (agent.id === sessionId) finish(agent) })
    if (settled) stop()
    else {
      signal.addEventListener('abort', cancel, { once: true })
      // Close both the registration/publication race and the abort race.
      const ready = ctx.agents.get(sessionId)
      if (signal.aborted) finish()
      else if (ready !== undefined) finish(ready)
    }
  })
}
