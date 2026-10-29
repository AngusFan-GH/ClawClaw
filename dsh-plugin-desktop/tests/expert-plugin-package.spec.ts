import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverExpertPluginPackages,
  expertPluginLeadAgent,
  expertPluginManifestSchema,
  findExpertPluginPackageBySession,
  isConversationCreatedExpertPlugin,
  projectExpertPluginAgents,
  projectExpertPluginAgent,
  projectExpertPluginTeam,
  readExpertPluginPackage,
  removeConversationCreatedExpertPlugin,
} from '../src/experts/expert-plugin-package.ts'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'clawclaw-expert-plugin-'))
  roots.push(root)
  return root
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

const localized = (zh: string, en: string) => ({ zh, en })
const bundledPluginRoot = fileURLToPath(new URL('../assets/expert-plugins/', import.meta.url))

function agentManifest() {
  return {
    name: 'legal-search-pro', version: '1.0.0', description: 'Legal retrieval', author: { name: 'Test' },
    agents: ['./agents/legal-search-pro.md'], skills: ['./skills/legal-search-engine'],
    dependencies: { connectors: ['pkulaw', 'pkulaw'] }, expertType: 'agent', agentName: 'legal-search-pro',
    profession: localized('法律检索专家', 'Legal Retrieval Expert'),
    displayDescription: localized('检索法规和类案', 'Retrieves statutes and cases'), avatar: 11,
    categoryId: '11-SecurityCompliance', defaultInitPrompt: localized('检索法规', 'Search statutes'),
    tags: [localized('法规', 'Statutes'), localized('类案', 'Cases'), localized('核验', 'Verification')],
    quickPrompts: [localized('一', 'One'), localized('二', 'Two'), localized('三', 'Three')],
  }
}

async function createAgentPackage(parent: string, name = 'legal-search-pro'): Promise<string> {
  const root = join(parent, name)
  await Promise.all([
    mkdir(join(root, '.clawclaw-plugin'), { recursive: true }),
    mkdir(join(root, 'agents'), { recursive: true }),
    mkdir(join(root, 'skills/legal-search-engine'), { recursive: true }),
  ])
  await Promise.all([
    writeJson(join(root, '.clawclaw-plugin/plugin.json'), agentManifest()),
    writeFile(join(root, 'agents/legal-search-pro.md'), '---\nname: legal-search-pro\ndescription: Legal retrieval\n---\nPersona\n'),
    writeFile(join(root, 'skills/legal-search-engine/SKILL.md'), '---\nname: legal-search-engine\ndescription: Search law\n---\nSearch.\n'),
  ])
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('ClawClaw expert plugin packages', () => {
  it('rejects team metadata that cannot cross the shared team snapshot boundary', async () => {
    const pkg = (await discoverExpertPluginPackages(bundledPluginRoot)).find(pkg => pkg.manifest.name === 'migrated-document-production-team')!
    expect(expertPluginManifestSchema.safeParse({ ...pkg.manifest, profession: { en: 'x'.repeat(41) } }).success).toBe(false)
    expect(expertPluginManifestSchema.safeParse({ ...pkg.manifest, defaultInitPrompt: { en: 'x'.repeat(2001) } }).success).toBe(false)
    expect(expertPluginManifestSchema.safeParse({ ...pkg.manifest, members: Array.from({ length: 9 }, () => pkg.manifest.members![0]) }).success).toBe(false)
  })
  it('ships valid migrated expert and Team packages', async () => {
    const packages = await discoverExpertPluginPackages(bundledPluginRoot)
    expect(packages.map(pkg => pkg.manifest.name).sort()).toEqual([
      'migrated-code-expert',
      'migrated-design-expert',
      'migrated-document-production-team',
      'migrated-spreadsheet-expert',
      'migrated-work-expert',
    ])
    expect(packages.find(pkg => pkg.manifest.name === 'migrated-document-production-team')?.manifest).toMatchObject({
      expertType: 'team',
      teamInfo: { leadAgent: 'doc-writer', memberAgents: ['doc-formatter', 'doc-converter'], execution: 'pipeline' },
    })
  })
  it('loads and projects an Agent package without rewriting its fields', async () => {
    const library = await temporaryRoot()
    const root = await createAgentPackage(library)
    const pkg = await readExpertPluginPackage(root)
    expect(pkg.manifest).toMatchObject({ name: 'legal-search-pro', expertType: 'agent', agentName: 'legal-search-pro' })
    expect(pkg.connectorDependencies).toEqual(['pkulaw'])
    expect(expertPluginLeadAgent(pkg).absolutePath).toBe(join(pkg.root, 'agents/legal-search-pro.md'))
    expect(projectExpertPluginAgent(pkg)).toMatchObject({
      slug: 'legal-search-pro', name: '法律检索专家', nameEn: 'Legal Retrieval Expert', division: 'legal', avatar: 11,
      skills: [{ name: 'legal-search-engine', required: true, enabled: true }],
      mcpServers: [{ name: 'pkulaw', required: true, enabled: true }],
      packageFormat: 'clawclaw-plugin', packageVersion: '1.0.0', packageType: 'agent',
    })
    expect(JSON.parse(await readFile(join(root, '.clawclaw-plugin/plugin.json'), 'utf8'))).toEqual(agentManifest())
  })

  it('locates only the package registered by the current creation session', async () => {
    const library = await temporaryRoot()
    const current = await createAgentPackage(library, 'current-package')
    const unrelated = await createAgentPackage(library, 'unrelated-package')
    await Promise.all([
      writeFile(join(current, '.created-by-session'), 'session-current'),
      writeFile(join(unrelated, '.created-by-session'), 'session-other'),
    ])

    await expect(findExpertPluginPackageBySession(library, 'session-current')).resolves.toMatchObject({
      root: expect.stringMatching(/current-package$/u),
      manifest: { name: 'legal-search-pro' },
    })
    await expect(findExpertPluginPackageBySession(library, 'missing-session')).resolves.toBeUndefined()
  })

  it('deletes a direct personal package even when it predates session markers', async () => {
    const library = await temporaryRoot()
    const owned = await createAgentPackage(library, 'owned-package')
    const pkg = await readExpertPluginPackage(owned)
    await expect(isConversationCreatedExpertPlugin(library, pkg)).resolves.toBe(true)
    await expect(removeConversationCreatedExpertPlugin(library, 'legal-search-pro')).resolves.toMatchObject({ manifest: { name: 'legal-search-pro' } })
    await expect(readFile(join(owned, '.clawclaw-plugin/plugin.json'), 'utf8')).rejects.toThrow()
  })

  it('recognizes and cleans a legacy package registered in the personal marketplace', async () => {
    const marketplace = await temporaryRoot()
    const plugins = join(marketplace, 'plugins')
    const owned = await createAgentPackage(plugins, 'legacy-owned')
    const registry = join(marketplace, '.clawclaw-plugin/marketplace.json')
    await mkdir(join(marketplace, '.clawclaw-plugin'), { recursive: true })
    await writeJson(registry, {
      name: 'my-experts', description: 'personal',
      plugins: [{ name: 'legal-search-pro', source: './plugins/legacy-owned', description: 'legacy' }],
    })
    await expect(isConversationCreatedExpertPlugin(plugins, await readExpertPluginPackage(owned))).resolves.toBe(true)
    await removeConversationCreatedExpertPlugin(plugins, 'legal-search-pro')
    expect(JSON.parse(await readFile(registry, 'utf8'))).toMatchObject({ plugins: [] })
  })

  it('refuses nested and symlinked packages outside the personal library boundary', async () => {
    const library = await temporaryRoot()
    const nestedParent = join(library, 'nested')
    const nested = await createAgentPackage(nestedParent, 'nested-package')
    await writeFile(join(nested, '.created-by-session'), 'session-nested')
    await expect(isConversationCreatedExpertPlugin(library, await readExpertPluginPackage(nested))).resolves.toBe(false)

    const outside = await temporaryRoot()
    const linkedTarget = await createAgentPackage(outside, 'linked-target')
    await writeFile(join(linkedTarget, '.created-by-session'), 'session-linked')
    await symlink(linkedTarget, join(library, 'linked-package'))
    await expect(removeConversationCreatedExpertPlugin(library, 'legal-search-pro')).rejects.toThrow('created through a conversation')
  })

  it('discovers versioned packages and validates a Team as a package', async () => {
    const library = await temporaryRoot()
    const root = join(library, 'stock-team/1.0.0')
    await Promise.all([
      mkdir(join(root, '.clawclaw-plugin'), { recursive: true }),
      mkdir(join(root, 'agents'), { recursive: true }),
    ])
    const manifest = {
      ...agentManifest(), name: 'stock-team', expertType: 'team', agentName: 'stock-team-lead',
      agents: ['./agents/stock-team-lead.md', './agents/analyst.md'], skills: undefined, dependencies: undefined,
      teamInfo: { leadAgent: 'stock-team-lead', memberAgents: ['analyst'] },
      members: [
        { id: 'stock-team-lead', profession: localized('主理人', 'Lead'), avatar: 0, role: 'lead' },
        { id: 'analyst', profession: localized('分析师', 'Analyst'), avatar: 1, role: 'member' },
      ],
      avatar: 0, tags: null, quickPrompts: null,
    }
    await Promise.all([
      writeJson(join(root, '.clawclaw-plugin/plugin.json'), manifest),
      writeFile(join(root, 'agents/stock-team-lead.md'), '---\nname: stock-team-lead\ndescription: Lead\n---\nLead.\n'),
      writeFile(join(root, 'agents/analyst.md'), '---\nname: analyst\ndescription: Analyst\n---\nAnalyze.\n'),
    ])
    const packages = await discoverExpertPluginPackages(library)
    expect(packages).toHaveLength(1)
    expect(packages[0]?.manifest).toMatchObject({ name: 'stock-team', expertType: 'team' })
    expect(projectExpertPluginAgent(packages[0]!)).toBeUndefined()
    expect(projectExpertPluginAgents(packages[0]!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'lead', expert: expect.objectContaining({ slug: 'stock-team--stock-team-lead', packageRole: 'lead', avatar: 0 }) }),
      expect.objectContaining({ role: 'member', expert: expect.objectContaining({ slug: 'stock-team--analyst', packageRole: 'member', avatar: 1 }) }),
    ]))
    expect(projectExpertPluginTeam(packages[0]!)).toMatchObject({
      id: 'plugin-team:stock-team', leadAgentSlug: 'stock-team--stock-team-lead', memberAgentSlugs: ['stock-team--analyst'],
    })
  })

  it('rejects traversal, symlinks and inconsistent team membership', async () => {
    const library = await temporaryRoot()
    const outside = join(library, 'outside.md')
    await writeFile(outside, 'private')
    const traversal = await createAgentPackage(library, 'traversal')
    await writeJson(join(traversal, '.clawclaw-plugin/plugin.json'), { ...agentManifest(), agents: ['./agents/../../outside.md'] })
    await expect(readExpertPluginPackage(traversal)).rejects.toThrow('Invalid expert plugin path')

    const linked = await createAgentPackage(library, 'linked')
    await rm(join(linked, 'agents/legal-search-pro.md'))
    await symlink(outside, join(linked, 'agents/legal-search-pro.md'))
    await expect(readExpertPluginPackage(linked)).rejects.toThrow('cannot contain symlinks')

    const team = await createAgentPackage(library, 'bad-team')
    await writeJson(join(team, '.clawclaw-plugin/plugin.json'), {
      ...agentManifest(), expertType: 'team', agentName: 'legal-search-pro',
      teamInfo: { leadAgent: 'legal-search-pro', memberAgents: ['missing-member'] },
      members: [
        { id: 'legal-search-pro', profession: localized('主理人', 'Lead'), avatar: 0, role: 'lead' },
        { id: 'missing-member', profession: localized('成员', 'Member'), avatar: 1, role: 'member' },
      ],
    })
    await expect(readExpertPluginPackage(team)).rejects.toThrow('teamInfo')
  })

  it('rejects legacy image paths and invalid preset avatar indices', async () => {
    const library = await temporaryRoot()
    const legacy = await createAgentPackage(library, 'legacy-avatar')
    await writeJson(join(legacy, '.clawclaw-plugin/plugin.json'), { ...agentManifest(), avatar: 'avatars/expert.png' })
    await expect(readExpertPluginPackage(legacy)).rejects.toThrow('avatar')

    const outOfRange = await createAgentPackage(library, 'out-of-range-avatar')
    await writeJson(join(outOfRange, '.clawclaw-plugin/plugin.json'), { ...agentManifest(), avatar: 36 })
    await expect(readExpertPluginPackage(outOfRange)).rejects.toThrow('avatar')
  })
})
