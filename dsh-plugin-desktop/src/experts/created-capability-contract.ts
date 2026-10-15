import { z } from 'zod'
import { expertSummarySchema } from './expert-contract.js'
import { teamSchema } from './team-contract.js'

export const createdCapabilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pending') }).strict(),
  z.object({ kind: z.literal('expert'), expert: expertSummarySchema }).strict(),
  z.object({ kind: z.literal('team'), team: teamSchema, experts: z.array(expertSummarySchema) }).strict(),
])

export type CreatedCapability = z.infer<typeof createdCapabilitySchema>
