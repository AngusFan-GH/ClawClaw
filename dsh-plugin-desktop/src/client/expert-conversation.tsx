/**
 * Conversation surfaces of the expert center.
 *
 * Identity is shown, never simulated: the badge reads the Session's own
 * `agentPreset` projection (the composition the Session actually runs), and
 * the prefill consumer only seeds the composer's draft through the public
 * input actions. No message content is rewritten.
 */

import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import { expertForPreset, type ExpertCenter } from './experts-center.ts'

export interface ExpertConversationInjected {
  readonly center: ExpertCenter
}

export type ExpertBadgeProps = PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'desktop.experts'>
  & InjectFace<ExpertConversationInjected>

/** Header chip naming the expert the visible Session runs, absent for other presets. */
export function ExpertSessionBadge({ center, t, useProjection }: ExpertBadgeProps): ReactNode {
  const preset = useProjection('agentPreset')
  const state = useSyncExternalStore(center.subscribe, center.getSnapshot)
  const expert = expertForPreset(state, typeof preset === 'string' ? preset : null)
  if (expert === undefined) return null
  return (
    <span className="dshExpertsBadge" data-expert={expert.id} title={t('badgeTitle', { name: expert.display?.name ?? expert.id })}>
      <span className="dshExpertsBadgeLabel">{t('badge')}</span>
      <span className="dshExpertsBadgeName">{expert.display?.name ?? expert.id}</span>
    </span>
  )
}

export type ExpertPrefillProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<ExpertConversationInjected>

/**
 * One-shot first-input seed for a summoned Session.
 *
 * The expert page stages the text before navigating; this consumer lands it in
 * the composer of the Session it was staged for, and only there.
 */
export function ExpertConversationPrefill({ center, useSession, inputActions }: ExpertPrefillProps): ReactNode {
  const sessionId = useSession(state => state.sessionId)
  useEffect(() => {
    const text = center.takePrefill(sessionId)
    if (text === undefined || text === '') return
    inputActions.setDraft(text)
  }, [center, sessionId, inputActions])
  return null
}
