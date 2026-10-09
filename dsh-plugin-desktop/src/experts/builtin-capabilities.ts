import type { ExpertCapabilityBinding } from './expert-contract.js'
import { resolveMcpCapabilityServer, type McpCapabilityId, type McpCapabilityServer } from '../mcp-capabilities.js'

export interface BuiltinExpertCapabilities {
  readonly skills: ExpertCapabilityBinding[]
  readonly mcpServers: ExpertCapabilityBinding[]
}

const DIVISION_SKILLS: Readonly<Record<string, readonly string[]>> = {
  academic: ['evidence-research'],
  company: ['business-operations'],
  design: ['product-design-review'],
  engineering: ['software-delivery'],
  finance: ['risk-compliance-review'],
  'game-development': ['software-delivery'],
  gis: ['software-delivery', 'data-analysis'],
  healthcare: ['risk-compliance-review'],
  hr: ['business-operations'],
  legal: ['risk-compliance-review'],
  marketing: ['content-production'],
  'paid-media': ['content-production', 'data-analysis'],
  product: ['product-design-review'],
  'project-management': ['business-operations'],
  research: ['evidence-research'],
  sales: ['business-operations'],
  security: ['risk-compliance-review', 'software-delivery'],
  'spatial-computing': ['software-delivery'],
  specialized: ['business-operations'],
  support: ['business-operations'],
  'supply-chain': ['business-operations', 'data-analysis'],
  testing: ['software-delivery'],
}

const DATA_SLUG = /(?:analytics|analyst|data-|database|forecast|pricing|statistic|metrics|reporter|inventory)/u
const EVIDENCE_SLUG = /(?:research|intelligence|historian|evidence|journal|trend)/u
const CONTENT_SLUG = /(?:content|document|writer|translator|publisher|podcast|video|social-media)/u
const COMPLIANCE_SLUG = /(?:audit|compliance|privacy|legal|policy|risk|security|fraud|tax)/u

const MCP_PROFILES = {
  sourceCode: 'source-control.github',
  workManagement: 'work-management.issues',
  knowledge: 'knowledge.search',
  data: 'database.sql',
  web: 'browser.automation',
  communication: 'communication.team',
  market: 'market-data.finance',
} as const

type McpProfile = keyof typeof MCP_PROFILES

function skillNames(slug: string, division: string): string[] {
  const names = [...(DIVISION_SKILLS[division] ?? ['business-operations'])]
  if (DATA_SLUG.test(slug)) names.push('data-analysis')
  if (EVIDENCE_SLUG.test(slug)) names.push('evidence-research')
  if (CONTENT_SLUG.test(slug)) names.push('content-production')
  if (COMPLIANCE_SLUG.test(slug)) names.push('risk-compliance-review')
  return [...new Set(names)].slice(0, 3)
}

function mcpProfiles(slug: string, division: string): McpProfile[] {
  const profiles: McpProfile[] = []
  if (division === 'engineering' || division === 'testing' || division === 'security'
    || /(?:developer|code|software|devops|sre|api|repository)/u.test(slug)) profiles.push('sourceCode')
  if (division === 'project-management' || /(?:project|jira|operations|product-manager|workflow)/u.test(slug)) profiles.push('workManagement')
  if (['academic', 'legal', 'research'].includes(division) || CONTENT_SLUG.test(slug)) profiles.push('knowledge')
  if (DATA_SLUG.test(slug) || ['finance', 'gis', 'supply-chain'].includes(division)) profiles.push('data')
  if (['academic', 'marketing', 'paid-media', 'research'].includes(division)
    || /(?:seo|trend|intelligence|research)/u.test(slug)) profiles.push('web')
  if (['hr', 'sales', 'support'].includes(division) || /(?:customer|social|recruit)/u.test(slug)) profiles.push('communication')
  if (division === 'finance' || /(?:investment|stock|trading|market|pricing)/u.test(slug)) profiles.push('market')
  return [...new Set(profiles)]
}

/**
 * Bind every bundled expert to ClawClaw-authored workflow Skills and canonical
 * MCP capability names. A configured alias is adopted when present, while an
 * absent server remains visible as an optional capability gap in the product.
 */
export function builtinExpertCapabilities(
  slug: string,
  division: string,
  configuredMcpServers: readonly (string | McpCapabilityServer)[] = [],
): BuiltinExpertCapabilities {
  const skills = skillNames(slug, division)
    .map(name => ({ name, required: true, enabled: true }))
  const profiles = mcpProfiles(slug, division)
  const mcpServers = profiles
    .map(profile => resolveMcpCapabilityServer(MCP_PROFILES[profile] as McpCapabilityId, configuredMcpServers))
    .filter((name, index, names) => names.indexOf(name) === index)
    .map(name => ({ name, required: false, enabled: true }))
  return { skills, mcpServers }
}
