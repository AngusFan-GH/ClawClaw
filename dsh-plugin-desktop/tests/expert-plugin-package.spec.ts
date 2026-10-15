import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverExpertPluginPackages,
  expertPluginLeadAgent,
  projectExpertPluginAgents,
  projectExpertPluginAgent,
  projectExpertPluginTeam,
  readExpertPluginPackage,
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

function agentManifest() {
  return {
    name: 'legal-search-pro', version: '1.0.0', description: 'Legal retrieval', author: { name: 'Test' },
    agents: ['./agents/legal-search-pro.md'], skills: ['./skills/legal-search-engine'],
    dependencies: { connectors: ['pkulaw', 'pkulaw'] }, expertType: 'agent', agentName: 'legal-search-pro',
    displayName: localized('法检 Pro', 'LexFinder Pro'), profession: localized('法律检索专家', 'Legal Retrieval Expert'),
    displayDescription: localized('检索法规和类案', 'Retrieves statutes and cases'), avatar: 'avatars/expert.png',
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
    mkdir(join(root, 'avatars'), { recursive: true }),
  ])
  await Promise.all([
    writeJson(join(root, '.clawclaw-plugin/plugin.json'), agentManifest()),
    writeFile(join(root, 'agents/legal-search-pro.md'), '---\nname: legal-search-pro\ndescription: Legal retrieval\n---\nPersona\n'),
    writeFile(join(root, 'skills/legal-search-engine/SKILL.md'), '---\nname: legal-search-engine\ndescription: Search law\n---\nSearch.\n'),
    writeFile(join(root, 'avatars/expert.png'), 'image'),
  ])
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('ClawClaw expert plugin packages', () => {
  it('loads and projects an Agent package without rewriting its fields', async () => {
    const library = await temporaryRoot()
    const root = await createAgentPackage(library)
    const pkg = await readExpertPluginPackage(root)
    expect(pkg.manifest).toMatchObject({ name: 'legal-search-pro', expertType: 'agent', agentName: 'legal-search-pro' })
    expect(pkg.connectorDependencies).toEqual(['pkulaw'])
    expect(expertPluginLeadAgent(pkg).absolutePath).toBe(join(pkg.root, 'agents/legal-search-pro.md'))
    expect(projectExpertPluginAgent(pkg)).toMatchObject({
      slug: 'legal-search-pro', name: '法检 Pro', nameEn: 'LexFinder Pro', division: 'legal',
      skills: [{ name: 'legal-search-engine', required: true, enabled: true }],
      mcpServers: [{ name: 'pkulaw', required: true, enabled: true }],
      packageFormat: 'clawclaw-plugin', packageVersion: '1.0.0', packageType: 'agent',
    })
    expect(JSON.parse(await readFile(join(root, '.clawclaw-plugin/plugin.json'), 'utf8'))).toEqual(agentManifest())
  })

  it('discovers versioned packages and validates a Team as a package', async () => {
    const library = await temporaryRoot()
    const root = join(library, 'stock-team/1.0.0')
    await Promise.all([
      mkdir(join(root, '.clawclaw-plugin'), { recursive: true }),
      mkdir(join(root, 'agents'), { recursive: true }),
      mkdir(join(root, 'avatars'), { recursive: true }),
    ])
    const manifest = {
      ...agentManifest(), name: 'stock-team', expertType: 'team', agentName: 'stock-team-lead',
      agents: ['./agents/stock-team-lead.md', './agents/analyst.md'], skills: undefined, dependencies: undefined,
      teamInfo: { leadAgent: 'stock-team-lead', memberAgents: ['analyst'] },
      members: [
        { id: 'stock-team-lead', name: localized('主理人', 'Lead'), profession: localized('主理人', 'Lead'), avatar: './avatars/lead.png', role: 'lead' },
        { id: 'analyst', name: localized('分析师', 'Analyst'), profession: localized('分析师', 'Analyst'), avatar: './avatars/analyst.png', role: 'member' },
      ],
      avatar: './avatars/team.png', tags: null, quickPrompts: null,
    }
    await Promise.all([
      writeJson(join(root, '.clawclaw-plugin/plugin.json'), manifest),
      writeFile(join(root, 'agents/stock-team-lead.md'), '---\nname: stock-team-lead\ndescription: Lead\n---\nLead.\n'),
      writeFile(join(root, 'agents/analyst.md'), '---\nname: analyst\ndescription: Analyst\n---\nAnalyze.\n'),
      writeFile(join(root, 'avatars/lead.png'), 'lead'), writeFile(join(root, 'avatars/analyst.png'), 'analyst'),
      writeFile(join(root, 'avatars/team.png'), 'team'),
    ])
    const packages = await discoverExpertPluginPackages(library)
    expect(packages).toHaveLength(1)
    expect(packages[0]?.manifest).toMatchObject({ name: 'stock-team', expertType: 'team' })
    expect(projectExpertPluginAgent(packages[0]!)).toBeUndefined()
    expect(projectExpertPluginAgents(packages[0]!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'lead', expert: expect.objectContaining({ slug: 'stock-team--stock-team-lead', packageRole: 'lead' }) }),
      expect.objectContaining({ role: 'member', expert: expect.objectContaining({ slug: 'stock-team--analyst', packageRole: 'member' }) }),
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
        { id: 'legal-search-pro', name: localized('主理人', 'Lead'), profession: localized('主理人', 'Lead'), avatar: './avatars/expert.png', role: 'lead' },
        { id: 'missing-member', name: localized('成员', 'Member'), profession: localized('成员', 'Member'), avatar: './avatars/expert.png', role: 'member' },
      ],
    })
    await expect(readExpertPluginPackage(team)).rejects.toThrow('teamInfo')
  })
})
