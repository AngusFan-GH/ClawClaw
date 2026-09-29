import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { decodeSkillBundle, listSkillFiles, previewSkillFile } from '../src/skill-bundle.ts'
import { DesktopSkillsController } from '../src/skills.ts'

const document = '---\nname: review\ndescription: Review\n---\nRun scripts/check.py and read references/guide.md.\n'
const entry = (path: string, content = '') => ({ path, base64: Buffer.from(content).toString('base64') })
describe('Skill bundles', () => {
  it.each(['../escape', '/absolute', 'C:/escape', 'scripts\\escape', './file', '.config/../../escape', 'a/../b', 'a//b', 'con.txt'])('rejects unsafe path %s', path => {
    expect(() => decodeSkillBundle([entry('SKILL.md', document), entry(path)])).toThrow('skillBundleInvalidPath')
  })
  it('rejects missing documents, duplicate paths, file-directory conflicts and oversized data', () => {
    expect(() => decodeSkillBundle([entry('readme.md')])).toThrow('skillBundleMissingDocument')
    expect(() => decodeSkillBundle([entry('SKILL.md'), entry('skill.md')])).toThrow('skillBundleInvalidPath')
    expect(() => decodeSkillBundle([entry('SKILL.md'), entry('a'), entry('a/b')])).toThrow('skillBundleInvalidPath')
    expect(() => decodeSkillBundle([entry('SKILL.md'), entry('large', 'x'.repeat(8 * 1024 * 1024))])).not.toThrow()
    expect(() => decodeSkillBundle([entry('SKILL.md', document), entry('large', 'x'.repeat(8 * 1024 * 1024))])).toThrow('skillBundleLimit')
    expect(() => decodeSkillBundle([entry('SKILL.md'), { path: 'bad', base64: 'invalid' }])).toThrow()
  })
  it('imports, previews, edits, recycles and restores resources without overwriting conflicts', async () => {
    const home = await mkdtemp(join(tmpdir(), 'clawclaw-bundle-'))
    vi.stubEnv('DSH_HOME', home)
    try {
      const path = join(home, 'skills', 'review', 'SKILL.md')
      const skill = { name: 'review', description: 'Review', content: 'Instructions', source: 'user-dsh', provider: 'filesystem', path,
        invocation: { modelInvocable: true, userInvocable: true } }
      const ctx = { get: () => undefined, skills: { snapshot: async () => ({ skills: [], complete: true }), get: async () => skill } } as unknown as Context
      const controller = new DesktopSkillsController(ctx)
      const files = [entry('SKILL.md', document), entry('scripts/check.py', 'print("ok")'), entry('references/guide.md', 'Guide'), entry('assets/pixel.bin', '\0\x01'), entry('.config/.settings.json', '{}'), entry('.env.example', 'EXAMPLE=true')]
      await controller.importBundle(files)
      expect(await readFile(join(home, 'skills/review/scripts/check.py'), 'utf8')).toBe('print("ok")')
      expect((await controller.files('review')).files.map(file => file.path)).toContain('references/guide.md')
      expect((await controller.files('review')).files.map(file => file.path)).toContain('.config/.settings.json')
      expect(await controller.file('review', '.config/.settings.json')).toMatchObject({ content: '{}', unavailable: false })
      expect(await controller.file('review', '.env.example')).toMatchObject({ content: 'EXAMPLE=true', unavailable: false })
      expect(await controller.file('review', 'scripts/check.py')).toMatchObject({ content: 'print("ok")', unavailable: false })
      expect(await controller.file('review', 'assets/pixel.bin')).toMatchObject({ unavailable: true })
      await expect(controller.importBundle(files)).rejects.toThrow('skillBundleConflict')
      await controller.update('review', { name: 'review', description: 'Updated', instructions: 'Updated instructions' }, (await controller.detail('review')).revision)
      expect(await readFile(join(home, 'skills/review/references/guide.md'), 'utf8')).toBe('Guide')
      const recycled = await controller.recycle('review')
      await expect(access(path)).rejects.toThrow()
      await controller.restore(recycled.recycled[0]!.id)
      expect(await readFile(join(home, 'skills/review/scripts/check.py'), 'utf8')).toBe('print("ok")')
      expect(await readFile(join(home, 'skills/review/.config/.settings.json'), 'utf8')).toBe('{}')
    } finally { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }) }
  })
  it('blocks symlinks, outside paths, binary and oversized previews', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawclaw-files-'))
    try {
      const documentPath = join(root, 'bundle/SKILL.md')
      await mkdir(join(root, 'bundle'))
      await writeFile(documentPath, document)
      await writeFile(join(root, 'secret'), 'private')
      await symlink(join(root, 'secret'), join(root, 'bundle/link'))
      await symlink(root, join(root, 'bundle/linked-dir'))
      await writeFile(join(root, 'bundle/large'), 'x'.repeat(256 * 1024 + 1))
      expect(await listSkillFiles(documentPath)).toContainEqual(expect.objectContaining({ path: 'link', blocked: true }))
      await expect(previewSkillFile(documentPath, 'link')).rejects.toThrow('skillBundleInvalidPath')
      await expect(previewSkillFile(documentPath, 'linked-dir/secret')).rejects.toThrow('skillBundleInvalidPath')
      await expect(previewSkillFile(documentPath, '../secret')).rejects.toThrow('skillBundleInvalidPath')
      expect(await previewSkillFile(documentPath, 'large')).toEqual({ path: 'large', unavailable: true })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
