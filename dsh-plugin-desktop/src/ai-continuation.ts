import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyDraftAssistance, draftAssistanceInject } from './input-assistance.ts'
export const name = 'desktop-ai-continuation'
export const inject = draftAssistanceInject
export const Config = z.object({ enabled: z.boolean().default(false).volatile() })
export function apply(ctx: Context): void { applyDraftAssistance(ctx, 'continuation') }
