import { z } from 'zod'
import { expertCapabilityBindingSchema } from './expert-contract.js'

export const pluginTeamStateSchema = z.object({
  packageName: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  enabled: z.boolean(),
}).strict()
export type PluginTeamState = z.infer<typeof pluginTeamStateSchema>

export const pluginTeamMemberSchema = z.object({
  slug: z.string().min(1).max(256),
  packageAgentId: z.string().min(1).max(128),
  name: z.string().min(1),
  description: z.string(),
  role: z.enum(['lead', 'member']),
})

export const pluginTeamConnectorSchema = z.object({
  dependency: z.string(),
  installed: z.boolean(),
  installable: z.boolean(),
  credentialsRequired: z.boolean(),
  serverName: z.string().optional(),
  connectorId: z.string().optional(),
  enabled: z.boolean(),
  state: z.enum(['missing', 'disabled', 'starting', 'running', 'error']),
  credentialsReady: z.boolean(),
  diagnosticCode: z.string(),
  error: z.string().optional(),
})
export type PluginTeamConnector = z.infer<typeof pluginTeamConnectorSchema>

export const pluginTeamSummarySchema = z.object({
  id: z.string().startsWith('plugin-team:'),
  packageName: z.string(),
  installedVersion: z.string(),
  availableVersion: z.string().optional(),
  source: z.enum(['local', 'project', 'user', 'github', 'marketplace']),
  status: z.enum(['installed', 'update-available', 'error']),
  enabled: z.boolean(),
  runtime: z.literal('plugin-lead'),
  name: z.string(),
  description: z.string(),
  defaultInitPrompt: z.string(),
  tags: z.array(z.string()),
  quickPrompts: z.array(z.string()),
  lead: pluginTeamMemberSchema,
  members: z.array(pluginTeamMemberSchema),
  skills: z.array(expertCapabilityBindingSchema),
  connectors: z.array(expertCapabilityBindingSchema),
  connectorStates: z.array(pluginTeamConnectorSchema),
})
export type PluginTeamSummary = z.infer<typeof pluginTeamSummarySchema>

export const pluginTeamSnapshotSchema = z.object({
  teams: z.array(pluginTeamSummarySchema),
  revision: z.number().int().min(0),
})
export type PluginTeamSnapshot = z.infer<typeof pluginTeamSnapshotSchema>
