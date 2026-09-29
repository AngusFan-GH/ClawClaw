import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { DesktopSkillsController } from '../src/skills.ts'

describe('permanent Skill removal', () => {
  it('deletes only confirmed IDs, preserves live Skills and reports failed targets independently', async () => {
    const home = await mkdtemp(join(tmpdir(), 'clawclaw-purge-'))
    vi.stubEnv('DSH_HOME', home)
    try {
      const root = join(home, 'skills/.recycle')
      const first = `first--${randomUUID()}`; const second = `second--${randomUUID()}`; const later = `later--${randomUUID()}`
      for (const id of [first, later]) {
        await mkdir(join(root, id, 'scripts'), { recursive: true })
        await writeFile(join(root, id, 'scripts/check.py'), 'contents')
      }
      await mkdir(join(home, 'skills/live'), { recursive: true })
      await writeFile(join(home, 'skills/live/SKILL.md'), 'keep')
      await symlink(join(home, 'skills/live'), join(root, second))
      await symlink(join(home, 'skills/live'), join(root, first, 'external'))
      const controller = new DesktopSkillsController({} as Context)
      await expect(controller.purge([first, '../live'])).rejects.toThrow('Invalid recycled Skill IDs')
      await expect(access(join(root, first))).resolves.toBeUndefined()
      expect(await controller.purge([first, second])).toEqual({ deleted: [first], failed: [second] })
      await expect(access(join(root, first))).rejects.toThrow()
      expect(await readFile(join(home, 'skills/live/SKILL.md'), 'utf8')).toBe('keep')
      await expect(access(join(root, later))).resolves.toBeUndefined()
      expect(await controller.purge([first])).toEqual({ deleted: [first], failed: [] })
      expect(await controller.purge([later])).toEqual({ deleted: [later], failed: [] })
    } finally { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }) }
  })
  it('rejects a recycle root redirected by a symlink', async () => {
    const home = await mkdtemp(join(tmpdir(), 'clawclaw-purge-root-'))
    vi.stubEnv('DSH_HOME', home)
    try {
      await mkdir(join(home, 'skills')); await mkdir(join(home, 'outside'))
      await symlink(join(home, 'outside'), join(home, 'skills/.recycle'))
      await expect(new DesktopSkillsController({} as Context).purge([`test--${randomUUID()}`])).rejects.toThrow('Invalid recycle directory')
      await expect(access(join(home, 'outside'))).resolves.toBeUndefined()
    } finally { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }) }
  })
})
