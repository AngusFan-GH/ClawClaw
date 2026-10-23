import { teamInputSchema, teamSnapshotSchema } from './team-contract.js'
import type { InvocationDescriptor, InvocationParameterDescriptor, TypertCodec } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { CUSTOM_EXPERT_SLUG, EXPERT_PLUGIN_NAME, catalogSnapshotSchema, customExpertInputSchema, expertEditSchema } from './expert-contract.js'
import { createdCapabilitySchema } from './created-capability-contract.js'

const enabledArraySchema = z.array(z.string())
const enabledStateSchema = z.object({
  enabled: enabledArraySchema,
  revision: z.number().int().min(0),
})
const expertPromptSchema = z.object({
  prompt: z.string(),
})

type BoundarySchema = { parse(value: unknown): unknown }

/**
 * alpha.1 及更早宿主读 `codec.schema.parse`；alpha.2 只接受 `codec.create()`。
 * 两套字段一起带上，才能在同一 peer 范围内挂载 Remote。
 */
function strictCodec(typeSymbol: string, schema: BoundarySchema): TypertCodec {
  return { mode: 'strict', typeSymbol, create: () => schema, schema } as TypertCodec
}

function jsonParameter(name: string, typeSymbol: string, schema: BoundarySchema): InvocationParameterDescriptor {
  return { name, wire: name, source: 'json', codec: strictCodec(typeSymbol, schema) }
}

/** 新接口仍沿用宿主 Typert 严格参数校验与既有鉴权入口。 */
function catalogMethod(method: string, parameters: InvocationDescriptor['parameters']): InvocationDescriptor {
  return {
    id: `dsh-plugin-desktop/experts#agencyAgents/${method}`,
    service: 'agencyAgents', namespace: 'agencyAgents', method,
    invocation: { kind: 'direct' }, parameters,
    result: strictCodec('AgencyAgentsCatalog', catalogSnapshotSchema),
  }
}
const revisionParameter = jsonParameter('expectedRevision', 'number', z.number().int().min(0))
const customSlugParameter = jsonParameter('slug', 'string', z.string().regex(CUSTOM_EXPERT_SLUG))
// Legacy custom UUIDs and personal plugin names share this safe slug format.
// The Host still checks ownership; editing remains restricted to UUID records.
const deletableSlugParameter = jsonParameter('slug', 'string', z.string().regex(EXPERT_PLUGIN_NAME))

/** Host 与 Client 共用的专家启用状态 Remote 严格契约。 */
export const AGENCY_AGENTS_DESCRIPTORS = [
  ...[
    {
      method: 'setTeamConnectorEnabled',
      parameters: [jsonParameter('id', 'string', z.string().startsWith('plugin-team:')), jsonParameter('dependency', 'string', z.string().min(1)), jsonParameter('enabled', 'boolean', z.boolean())],
    },
    {
      method: 'testTeamConnector',
      parameters: [jsonParameter('id', 'string', z.string().startsWith('plugin-team:')), jsonParameter('dependency', 'string', z.string().min(1))],
    },
    {
      method: 'installTeamConnector',
      parameters: [jsonParameter('id', 'string', z.string().startsWith('plugin-team:')), jsonParameter('dependency', 'string', z.string().min(1)), jsonParameter('values', 'Record<string,string>', z.record(z.string(), z.string()))],
    },
  ].map(({ method, parameters }): InvocationDescriptor => ({
    id: `dsh-plugin-desktop/experts#agencyAgents/${method}`, service: 'agencyAgents', namespace: 'agencyAgents', method,
    invocation: { kind: 'direct' }, parameters, result: strictCodec('AgencyTeamsSnapshot', teamSnapshotSchema),
  })),
  ...[
    { method: 'getTeams', parameters: [] },
    { method: 'recallTeam', parameters: [jsonParameter('id', 'string', z.string().min(1).max(128)), revisionParameter] },
    { method: 'saveTeam', parameters: [jsonParameter('team', 'ExpertTeamInput', teamInputSchema), revisionParameter] },
    { method: 'deleteTeam', parameters: [jsonParameter('id', 'string', z.string().min(1).max(128)), revisionParameter] },
  ].map(({ method, parameters }): InvocationDescriptor => ({
    id: `dsh-plugin-desktop/experts#agencyAgents/${method}`, service: 'agencyAgents', namespace: 'agencyAgents', method,
    invocation: { kind: 'direct' }, parameters, result: strictCodec('AgencyTeamsSnapshot', teamSnapshotSchema),
  })),
  catalogMethod('getCatalog', []),
  {
    id: 'dsh-plugin-desktop/experts#agencyAgents/getCreatedCapability',
    service: 'agencyAgents', namespace: 'agencyAgents', method: 'getCreatedCapability',
    invocation: { kind: 'direct' },
    parameters: [jsonParameter('sessionId', 'string', z.string().trim().min(1).max(256))],
    result: strictCodec('CreatedCapability', createdCapabilitySchema),
  },
  catalogMethod('saveCustomExpert', [
    jsonParameter('expert', 'CustomExpertInput', customExpertInputSchema),
    jsonParameter('enabled', 'boolean', z.boolean()),
    revisionParameter,
  ]),
  catalogMethod('deleteCustomExpert', [deletableSlugParameter, revisionParameter]),
  {
    id: 'dsh-plugin-desktop/experts#agencyAgents/getCustomExpert',
    service: 'agencyAgents', namespace: 'agencyAgents', method: 'getCustomExpert',
    invocation: { kind: 'direct' }, parameters: [customSlugParameter],
    result: strictCodec('CustomExpertInput', expertEditSchema),
  },
  {
    id: 'dsh-plugin-desktop/experts#agencyAgents/getEnabled',
    service: 'agencyAgents',
    namespace: 'agencyAgents',
    method: 'getEnabled',
    invocation: { kind: 'direct' },
    parameters: [],
    result: strictCodec('AgencyAgentsEnabledState', enabledStateSchema),
  },
  {
    id: 'dsh-plugin-desktop/experts#agencyAgents/setEnabled',
    service: 'agencyAgents',
    namespace: 'agencyAgents',
    method: 'setEnabled',
    invocation: { kind: 'direct' },
    parameters: [
      jsonParameter('enabled', 'string[]', enabledArraySchema),
      jsonParameter('expectedRevision', 'number', z.number().int().min(0)),
    ],
    result: strictCodec('AgencyAgentsEnabledState', enabledStateSchema),
  },
  {
    id: 'dsh-plugin-desktop/experts#agencyAgents/getPrompt',
    service: 'agencyAgents',
    namespace: 'agencyAgents',
    method: 'getPrompt',
    invocation: { kind: 'direct' },
    parameters: [
      jsonParameter('slug', 'string', z.string().min(1).max(128)),
      jsonParameter('division', 'string', z.string().min(1).max(64)),
    ],
    result: strictCodec('AgencyAgentsPrompt', expertPromptSchema),
  },
] as const satisfies readonly InvocationDescriptor[]
