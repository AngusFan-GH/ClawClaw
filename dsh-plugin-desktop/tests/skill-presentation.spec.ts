import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { BUNDLED_INTERNAL_SKILL_ENTRIES, internalSkillEntry } from '../src/skill-invocation-policy.ts'
import { BUNDLED_SKILL_CATEGORIES, skillCategory } from '../src/client/skill-presentation.ts'
import { BUNDLED_SKILL_PRESENTATION, presentSkill, skillDisplayName } from '../src/client/skill-labels.ts'

describe('Skill purpose classification', () => {
  it('assigns every bundled Skill exactly once, with no stale entries', async () => {
    const root = fileURLToPath(new URL('../assets/skills/', import.meta.url))
    const names: string[] = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const text = await readFile(join(root, entry.name, 'SKILL.md'), 'utf8')
      names.push((parse(text.split('---')[1]!) as { name: string }).name)
    }
    const classified = Object.values(BUNDLED_SKILL_CATEGORIES).flat()
    expect(new Set(classified).size).toBe(classified.length)
    expect([...classified].sort()).toEqual(names.sort())
    expect(Object.keys(BUNDLED_SKILL_PRESENTATION).sort()).toEqual(names.sort())
    expect(new Set(Object.values(BUNDLED_SKILL_PRESENTATION).map(item => item[0])).size).toBe(names.length)
  })

  it('uses localized names for built-ins without renaming imported or custom Skills', () => {
    const base = { name: 'office-word-workflow', description: 'User description' }
    expect(presentSkill({ ...base, source: 'bundled' }, 'zh').name).toBe('Word文档与模板')
    expect(presentSkill({ ...base, source: 'user-dsh' }, 'zh')).toEqual(base)
    expect(presentSkill({ ...base, source: 'plugin:custom' }, 'zh')).toEqual(base)
    expect(skillDisplayName('unknown-workflow', 'en')).toBe('unknown-workflow')
    expect(skillDisplayName('constructor', 'zh')).toBe('constructor')
  })

  it('uses the primary deliverable for ambiguous built-in names', () => {
    expect(skillCategory('design-token')).toBe('office')
    expect(skillCategory('html-review')).toBe('office')
    expect(skillCategory('component-instance')).toBe('design')
    expect(skillCategory('ardot-design-to-code')).toBe('development')
    expect(skillCategory('tech-blog-expert')).toBe('content')
    expect(skillCategory('risk-compliance-review')).toBe('compliance')
    expect(skillCategory('weixinpay-pay')).toBe('business')
  })

  it('falls back for imported identifiers, including arbitrary names', () => {
    expect(skillCategory('company-data-analysis')).toBe('data')
    expect(skillCategory('custom-legal-review')).toBe('compliance')
    expect(skillCategory('my-workflow')).toBe('productivity')
    expect(skillCategory('constructor')).toBe('productivity')
  })
})

describe('Bundled Skill invocation audit', () => {
  it('accounts for every internal-only Skill and keeps every entry callable', async () => {
    const root = fileURLToPath(new URL('../assets/skills/', import.meta.url))
    const definitions = new Map<string, Record<string, unknown>>()
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const text = await readFile(join(root, entry.name, 'SKILL.md'), 'utf8')
      definitions.set(entry.name, parse(text.split('---')[1]!))
    }
    const internal = [...definitions].filter(([, data]) => data['disable-model-invocation'] === true && data['user-invocable'] === false).map(([name]) => name)
    expect(internal.sort()).toEqual(Object.keys(BUNDLED_INTERNAL_SKILL_ENTRIES).sort())
    for (const name of Object.values(BUNDLED_INTERNAL_SKILL_ENTRIES)) {
      const entry = definitions.get(name)
      expect(entry, name).toBeDefined()
      expect(entry!['disable-model-invocation'] !== true || entry!['user-invocable'] !== false, name).toBe(true)
    }
    expect(definitions.get('brief-compose')).toMatchObject({ 'disable-model-invocation': false, 'user-invocable': true })
  })

  it('distinguishes internal references from user-disabled or manual-only Skills', () => {
    const internal = { name: 'html-review', source: 'bundled', modelInvocable: false, userInvocable: false }
    expect(internalSkillEntry(internal)).toBe('tencent-docx')
    expect(internalSkillEntry({ ...internal, source: 'user-dsh' })).toBeUndefined()
    expect(internalSkillEntry({ ...internal, userInvocable: true })).toBeUndefined()
    expect(internalSkillEntry({ ...internal, name: 'custom-disabled' })).toBeUndefined()
    expect(internalSkillEntry({ ...internal, name: 'constructor' })).toBeUndefined()
  })
})
