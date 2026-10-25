import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyDraftAssistance, draftAssistanceInject } from './input-assistance.ts'
export const name = 'desktop-ai-draft-optimization'
export const inject = draftAssistanceInject
// Loader resolves defaults into fiber.config before Settings exposes the form.
// A legacy settings registration alone does not populate the Client's value.
export const Config = z.object({ enabled: z.boolean().default(true).volatile() })
export function apply(ctx: Context): void { applyDraftAssistance(ctx, 'optimization') }
