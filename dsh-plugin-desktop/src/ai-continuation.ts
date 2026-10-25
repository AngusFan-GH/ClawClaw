import type { Context } from '@deepseek-ai/cordis'
import { applyDraftAssistance, draftAssistanceInject } from './input-assistance.ts'
export const name = 'desktop-ai-continuation'
export const inject = draftAssistanceInject
export function apply(ctx: Context): void { applyDraftAssistance(ctx, 'continuation') }
