import { lstat, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { z } from 'zod'
import type { ExpertCapabilityBinding, ExpertSummary } from './expert-contract.js'
import { EXPERT_PLUGIN_NAME } from './expert-contract.js'
import { ZH_DIVISION } from './names.js'

const PACKAGE_MANIFEST = join('.clawclaw-plugin', 'plugin.json')
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_DISCOVERED_PACKAGES = 500
const MAX_DISCOVERY_DEPTH = 5
const packageNameSchema = z.string().regex(EXPERT_PLUGIN_NAME)
const packagePathSchema = z.string().min(3).max(512)
const presetAvatarSchema = z.number().int().min(0).max(35)
const personalMarketplaceSchema = z.object({
  name: z.literal('my-experts'),
  plugins: z.array(z.object({ name: packageNameSchema, source: z.string() }).passthrough()),
}).passthrough()

export const expertPluginLocalizedTextSchema = z.object({
  zh: z.string().trim().min(1).optional(),
  en: z.string().trim().min(1).optional(),
}).passthrough().refine(value => value.zh !== undefined || value.en !== undefined, 'localized text requires zh or en')
export type ExpertPluginLocalizedText = z.infer<typeof expertPluginLocalizedTextSchema>

const authorSchema = z.union([
  z.string().trim().min(1),
  z.object({ name: z.string().trim().min(1), email: z.string().optional(), url: z.string().optional() }).passthrough(),
])
const memberSchema = z.object({
  id: packageNameSchema,
  profession: expertPluginLocalizedTextSchema,
  avatar: presetAvatarSchema,
  role: z.enum(['lead', 'member']),
}).passthrough()

export const expertPluginManifestSchema = z.object({
  name: packageNameSchema,
  version: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1),
  author: authorSchema,
  agents: z.array(packagePathSchema).min(1),
  skills: z.array(packagePathSchema).optional(),
  dependencies: z.object({ connectors: z.array(packageNameSchema).default([]) }).passthrough().optional(),
  expertType: z.enum(['agent', 'team']),
  agentName: packageNameSchema,
  teamInfo: z.object({
    leadAgent: packageNameSchema,
    memberAgents: z.array(packageNameSchema),
  }).passthrough().optional(),
  members: z.array(memberSchema).optional(),
  profession: expertPluginLocalizedTextSchema,
  displayDescription: expertPluginLocalizedTextSchema.optional(),
  avatar: presetAvatarSchema,
  categoryId: z.string().trim().min(1).max(128),
  defaultInitPrompt: expertPluginLocalizedTextSchema,
  tags: z.array(expertPluginLocalizedTextSchema).length(3).nullish(),
  quickPrompts: z.array(expertPluginLocalizedTextSchema).length(3).nullish(),
}).passthrough().superRefine((value, ctx) => {
  if (value.expertType === 'agent') {
    if (value.agents.length !== 1) ctx.addIssue({ code: 'custom', path: ['agents'], message: 'agent package requires exactly one agent' })
    if (value.teamInfo !== undefined) ctx.addIssue({ code: 'custom', path: ['teamInfo'], message: 'agent package cannot declare teamInfo' })
    if (value.members !== undefined) ctx.addIssue({ code: 'custom', path: ['members'], message: 'agent package cannot declare members' })
    return
  }
  if (value.teamInfo === undefined) ctx.addIssue({ code: 'custom', path: ['teamInfo'], message: 'team package requires teamInfo' })
  if (value.members === undefined || value.members.length < 2) ctx.addIssue({ code: 'custom', path: ['members'], message: 'team package requires lead and members' })
})
export type ExpertPluginManifest = z.infer<typeof expertPluginManifestSchema>

export interface ExpertPluginPackageAgent {
  readonly id: string
  readonly relativePath: string
  readonly absolutePath: string
}

export interface ExpertPluginPackage {
  readonly root: string
  readonly manifestPath: string
  readonly manifest: ExpertPluginManifest
  readonly agents: readonly ExpertPluginPackageAgent[]
  readonly skillRoots: readonly string[]
  readonly connectorDependencies: readonly string[]
}

export interface ProjectedExpertPluginAgent {
  readonly expert: ExpertSummary
  readonly personaPath: string
  readonly packageAgentId: string
  readonly role: 'agent' | 'lead' | 'member'
}

export interface ExpertPluginTeamDefinition {
  readonly id: string
  readonly packageName: string
  readonly packageVersion: string
  readonly name: ExpertPluginLocalizedText
  readonly description: ExpertPluginLocalizedText
  readonly defaultInitPrompt: ExpertPluginLocalizedText
  readonly tags: readonly ExpertPluginLocalizedText[]
  readonly quickPrompts: readonly ExpertPluginLocalizedText[]
  readonly leadAgentSlug: string
  readonly memberAgentSlugs: readonly string[]
  readonly skills: readonly ExpertCapabilityBinding[]
  readonly connectors: readonly ExpertCapabilityBinding[]
  readonly conversationCreated?: boolean
}

function packageRelativePath(value: string): string {
  if (value.includes('\\') || isAbsolute(value)) throw new Error(`Invalid expert plugin path: ${value}`)
  const normalized = value.startsWith('./') ? value.slice(2) : value
  const parts = normalized.split('/')
  if (parts.length === 0 || parts.some(part => part === '' || part === '.' || part === '..')) throw new Error(`Invalid expert plugin path: ${value}`)
  return parts.join('/')
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

async function resolvePackageEntry(root: string, value: string, expected: 'file' | 'directory'): Promise<string> {
  const relativePath = packageRelativePath(value)
  let current = root
  for (const segment of relativePath.split('/')) {
    current = join(current, segment)
    const info = await lstat(current).catch(() => undefined)
    if (info === undefined) throw new Error(`Missing expert plugin path: ${value}`)
    if (info.isSymbolicLink()) throw new Error(`Expert plugin path cannot contain symlinks: ${value}`)
  }
  const target = await realpath(current)
  if (!isInside(root, target)) throw new Error(`Expert plugin path escapes its root: ${value}`)
  const info = await lstat(target)
  if (expected === 'file' ? !info.isFile() : !info.isDirectory()) throw new Error(`Expert plugin path has the wrong type: ${value}`)
  return target
}

function agentId(path: string): string {
  const name = basename(packageRelativePath(path))
  if (!name.endsWith('.md')) throw new Error(`Expert plugin agent must be a Markdown file: ${path}`)
  return name.slice(0, -3)
}

function validateTeam(manifest: ExpertPluginManifest, agentIds: readonly string[]): void {
  if (manifest.expertType === 'agent') {
    if (manifest.agentName !== agentIds[0]) throw new Error('Expert plugin agentName must match its Agent Markdown filename')
    return
  }
  const team = manifest.teamInfo!
  if (manifest.agentName !== team.leadAgent) throw new Error('Expert plugin team agentName must equal teamInfo.leadAgent')
  const declared = new Set(agentIds)
  if (declared.size !== agentIds.length || !declared.has(team.leadAgent)) throw new Error('Expert plugin Team Agent IDs must be unique and include the lead')
  if (team.memberAgents.includes(team.leadAgent) || new Set(team.memberAgents).size !== team.memberAgents.length) throw new Error('Expert plugin teamInfo.memberAgents must be unique and exclude the lead')
  if (team.memberAgents.some(id => !declared.has(id)) || declared.size !== team.memberAgents.length + 1) throw new Error('Expert plugin teamInfo must reference every packaged Agent exactly once')
  const members = manifest.members!
  const memberIds = new Set(members.map(member => member.id))
  if (memberIds.size !== members.length || memberIds.size !== declared.size || [...declared].some(id => !memberIds.has(id))) throw new Error('Expert plugin members must match packaged Agent IDs')
  if (members.filter(member => member.role === 'lead').length !== 1 || members.find(member => member.role === 'lead')?.id !== team.leadAgent) throw new Error('Expert plugin members must identify exactly one matching lead')
}

export async function readExpertPluginPackage(packageRoot: string): Promise<ExpertPluginPackage> {
  const rootInfo = await lstat(packageRoot).catch(() => undefined)
  if (rootInfo === undefined || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error(`Invalid expert plugin root: ${packageRoot}`)
  const root = await realpath(packageRoot)
  const manifestPath = join(root, PACKAGE_MANIFEST)
  const manifestInfo = await lstat(manifestPath).catch(() => undefined)
  if (manifestInfo === undefined || !manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > MAX_MANIFEST_BYTES) throw new Error(`Invalid expert plugin manifest: ${manifestPath}`)
  let source: unknown
  try {
    source = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (cause) {
    throw new Error(`Cannot parse expert plugin manifest: ${manifestPath}`, { cause })
  }
  const parsed = expertPluginManifestSchema.safeParse(source)
  if (!parsed.success) throw new Error(`Invalid expert plugin manifest: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
  const manifest = parsed.data
  const agents = await Promise.all(manifest.agents.map(async relativePath => ({
    id: agentId(relativePath),
    relativePath,
    absolutePath: await resolvePackageEntry(root, relativePath, 'file'),
  })))
  validateTeam(manifest, agents.map(agent => agent.id))
  const skillRoots = await Promise.all((manifest.skills ?? []).map(async path => {
    const skillRoot = await resolvePackageEntry(root, path, 'directory')
    await resolvePackageEntry(root, `${path}/SKILL.md`, 'file')
    return skillRoot
  }))
  return {
    root,
    manifestPath,
    manifest,
    agents,
    skillRoots,
    connectorDependencies: [...new Set(manifest.dependencies?.connectors ?? [])],
  }
}

async function discoverPackageRoots(root: string, depth: number, found: string[]): Promise<void> {
  if (found.length >= MAX_DISCOVERED_PACKAGES) throw new Error(`Expert plugin discovery exceeds ${MAX_DISCOVERED_PACKAGES} packages`)
  const directManifest = join(root, PACKAGE_MANIFEST)
  const direct = await lstat(directManifest).catch(() => undefined)
  if (direct?.isFile() && !direct.isSymbolicLink()) {
    found.push(root)
    return
  }
  if (depth >= MAX_DISCOVERY_DEPTH) return
  const entries = await readdir(root, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue
    await discoverPackageRoots(join(root, entry.name), depth + 1, found)
  }
}

export async function discoverExpertPluginPackages(root: string): Promise<ExpertPluginPackage[]> {
  const info = await lstat(root).catch(() => undefined)
  if (info === undefined || !info.isDirectory() || info.isSymbolicLink()) throw new Error(`Invalid expert plugin library: ${root}`)
  const canonicalRoot = await realpath(root)
  const roots: string[] = []
  await discoverPackageRoots(canonicalRoot, 0, roots)
  const packages: ExpertPluginPackage[] = []
  for (const packageRoot of roots) {
    try {
      packages.push(await readExpertPluginPackage(packageRoot))
    } catch (error) {
      console.warn(`[clawclaw-experts] skipping invalid expert plugin ${packageRoot}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return packages
}

/** Locate one package created by a conversation without parsing the full library. */
export async function findExpertPluginPackageBySession(
  pluginsRoot: string,
  sessionId: string,
): Promise<ExpertPluginPackage | undefined> {
  const rootInfo = await lstat(pluginsRoot).catch(() => undefined)
  if (rootInfo === undefined || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return undefined
  const canonicalRoot = await realpath(pluginsRoot)
  const matches: Array<{ readonly root: string; readonly modified: number }> = []
  for (const entry of await readdir(canonicalRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue
    const packageRoot = join(canonicalRoot, entry.name)
    const marker = join(packageRoot, '.created-by-session')
    const info = await lstat(marker).catch(() => undefined)
    if (info === undefined || !info.isFile() || info.isSymbolicLink() || info.size > 512) continue
    const owner = (await readFile(marker, 'utf8')).trim()
    if (owner !== sessionId) continue
    matches.push({ root: packageRoot, modified: (await stat(marker)).mtimeMs })
  }
  const match = matches.sort((left, right) => right.modified - left.modified)[0]
  return match === undefined ? undefined : readExpertPluginPackage(match.root)
}

async function personalMarketplaceRecord(
  pluginsRoot: string,
  pkg: ExpertPluginPackage,
): Promise<{ readonly path: string; readonly value: z.infer<typeof personalMarketplaceSchema>; readonly source: string } | undefined> {
  const path = join(dirname(pluginsRoot), '.clawclaw-plugin', 'marketplace.json')
  const info = await lstat(path).catch(() => undefined)
  if (info === undefined || !info.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST_BYTES) return undefined
  let sourceValue: unknown
  try {
    sourceValue = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
  const parsed = personalMarketplaceSchema.safeParse(sourceValue)
  if (!parsed.success) return undefined
  const source = `./plugins/${basename(pkg.root)}`
  return parsed.data.plugins.some(entry => entry.name === pkg.manifest.name && entry.source === source)
    ? { path, value: parsed.data, source }
    : undefined
}

/** Every validated direct child of the dedicated my-experts library is user-managed. */
export async function isConversationCreatedExpertPlugin(
  pluginsRoot: string,
  pkg: ExpertPluginPackage,
): Promise<boolean> {
  const rootInfo = await lstat(pluginsRoot).catch(() => undefined)
  if (rootInfo === undefined || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return false
  const canonicalRoot = await realpath(pluginsRoot)
  const packageRoot = await realpath(pkg.root).catch(() => undefined)
  if (packageRoot === undefined) return false
  const child = relative(canonicalRoot, packageRoot)
  return child !== '' && !child.includes(sep) && isInside(canonicalRoot, packageRoot)
}

/** Remove one conversation-created package after ownership and path validation. */
export async function removeConversationCreatedExpertPlugin(
  pluginsRoot: string,
  packageName: string,
): Promise<ExpertPluginPackage> {
  const name = packageNameSchema.parse(packageName)
  const rootInfo = await lstat(pluginsRoot).catch(() => undefined)
  if (rootInfo === undefined || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Conversation-created expert library is unavailable.')
  const canonicalRoot = await realpath(pluginsRoot)
  const matches: ExpertPluginPackage[] = []
  for (const entry of await readdir(canonicalRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue
    const candidate = join(canonicalRoot, entry.name)
    const candidateRoot = await realpath(candidate)
    const child = relative(canonicalRoot, candidateRoot)
    if (child === '' || child.includes(sep) || !isInside(canonicalRoot, candidateRoot)) continue
    const pkg = await readExpertPluginPackage(candidateRoot).catch(() => undefined)
    if (pkg?.manifest.name === name) matches.push(pkg)
  }
  if (matches.length !== 1) throw new Error(matches.length === 0
    ? 'Only experts and teams created through a conversation can be deleted.'
    : 'Multiple conversation-created packages use the same name; deletion was cancelled.')
  const match = matches[0]!
  const marketplace = await personalMarketplaceRecord(canonicalRoot, match)
  await rm(match.root, { recursive: true })
  if (marketplace !== undefined) {
    const next = { ...marketplace.value, plugins: marketplace.value.plugins.filter(entry =>
      entry.name !== match.manifest.name || entry.source !== marketplace.source) }
    try {
      await writeFile(marketplace.path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.warn(`[clawclaw-experts] deleted ${match.manifest.name} but could not update the personal marketplace registry:`, error)
    }
  }
  return match
}

const PLUGIN_DIVISIONS: Readonly<Record<string, string>> = {
  '01-ProductDesign': 'design',
  '02-Engineering': 'engineering',
  '03-GameSpatial': 'game-development',
  '04-DataAI': 'research',
  '05-MarketingGrowth': 'marketing',
  '06-ContentCreative': 'marketing',
  '07-SalesCommerce': 'sales',
  '08-FinanceInvestment': 'finance',
  '09-OperationsHR': 'hr',
  '10-ProjectQuality': 'project-management',
  '11-SecurityCompliance': 'legal',
  '12-IndustryConsultant': 'specialized',
}

function localized(value: ExpertPluginLocalizedText | undefined, locale: 'zh' | 'en'): string {
  return value?.[locale] ?? value?.[locale === 'zh' ? 'en' : 'zh'] ?? ''
}

const requiredBinding = (name: string): ExpertCapabilityBinding => ({ name, required: true, enabled: true })

function projectedAgentSlug(pkg: ExpertPluginPackage, agentId: string): string {
  return pkg.manifest.expertType === 'agent' ? pkg.manifest.name : `${pkg.manifest.name}--${agentId}`
}

function packageCapabilities(pkg: ExpertPluginPackage): Pick<ExpertSummary, 'skills' | 'mcpServers'> {
  return {
    skills: pkg.skillRoots.map(path => requiredBinding(basename(path))),
    mcpServers: pkg.connectorDependencies.map(requiredBinding),
  }
}

/** Project every packaged Agent without collapsing Team members into the lead. */
export function projectExpertPluginAgents(pkg: ExpertPluginPackage): ProjectedExpertPluginAgent[] {
  const manifest = pkg.manifest
  const division = PLUGIN_DIVISIONS[manifest.categoryId] ?? 'specialized'
  const capabilities = packageCapabilities(pkg)
  return pkg.agents.map((agent) => {
    const member = manifest.members?.find(candidate => candidate.id === agent.id)
    const role = manifest.expertType === 'agent' ? 'agent' : member!.role
    const profession = member?.profession ?? manifest.profession
    const description = manifest.expertType === 'agent' ? manifest.displayDescription : profession
    return {
      packageAgentId: agent.id,
      personaPath: agent.absolutePath,
      role,
      expert: {
        slug: projectedAgentSlug(pkg, agent.id),
        name: localized(profession, 'zh'),
        nameEn: localized(profession, 'en'),
        description: localized(description, 'zh') || manifest.description,
        descriptionEn: localized(description, 'en') || manifest.description,
        emoji: '',
        division,
        divisionZh: ZH_DIVISION[division] ?? division,
        custom: false,
        avatar: member?.avatar ?? manifest.avatar,
        ...capabilities,
        packageFormat: 'clawclaw-plugin',
        packageVersion: manifest.version,
        packageType: manifest.expertType,
        packageName: manifest.name,
        packageAgentId: agent.id,
        packageRole: role,
      },
    }
  })
}

export function projectExpertPluginAgent(pkg: ExpertPluginPackage): ExpertSummary | undefined {
  return pkg.manifest.expertType === 'agent' ? projectExpertPluginAgents(pkg)[0]!.expert : undefined
}

export function projectExpertPluginTeam(pkg: ExpertPluginPackage): ExpertPluginTeamDefinition | undefined {
  const manifest = pkg.manifest
  if (manifest.expertType !== 'team') return undefined
  const projected = projectExpertPluginAgents(pkg)
  const lead = projected.find(agent => agent.role === 'lead')!
  const capabilities = packageCapabilities(pkg)
  return {
    id: `plugin-team:${manifest.name}`,
    packageName: manifest.name,
    packageVersion: manifest.version,
    name: manifest.profession,
    description: manifest.displayDescription ?? { en: manifest.description },
    defaultInitPrompt: manifest.defaultInitPrompt,
    tags: manifest.tags ?? [],
    quickPrompts: manifest.quickPrompts ?? [],
    leadAgentSlug: lead.expert.slug,
    memberAgentSlugs: projected.filter(agent => agent.role === 'member').map(agent => agent.expert.slug),
    skills: capabilities.skills,
    connectors: capabilities.mcpServers,
  }
}

export function expertPluginLeadAgent(pkg: ExpertPluginPackage): ExpertPluginPackageAgent {
  const lead = pkg.agents.find(agent => agent.id === pkg.manifest.agentName)
  if (lead === undefined) throw new Error(`Expert plugin lead Agent is missing: ${pkg.manifest.name}`)
  return lead
}
