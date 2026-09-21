import { describe, expect, it } from 'vitest'
import { MAX_SKILL_FILE_BYTES, readSkillFile } from '../src/client/skill-file.ts'

describe('Skill file selection', () => {
  it('reads Markdown and removes a UTF-8 BOM without importing anything', async () => {
    expect(await readSkillFile({ name: 'SKILL.MD', size: 10, text: async () => '\uFEFF---\nname: review' })).toBe('---\nname: review')
  })
  it('rejects unsupported files, empty files, and oversized UTF-8 content', async () => {
    await expect(readSkillFile({ name: 'skill.zip', size: 1, text: async () => 'x' })).rejects.toThrow('fileType')
    await expect(readSkillFile({ name: 'SKILL.md', size: 1, text: async () => ' ' })).rejects.toThrow('fileEmpty')
    await expect(readSkillFile({ name: 'SKILL.md', size: MAX_SKILL_FILE_BYTES + 1, text: async () => 'x' })).rejects.toThrow('fileTooLarge')
    await expect(readSkillFile({ name: 'SKILL.md', size: 1, text: async () => '中'.repeat(100_000) })).rejects.toThrow('fileTooLarge')
    expect((await readSkillFile({ name: 'SKILL.md', size: MAX_SKILL_FILE_BYTES, text: async () => 'x'.repeat(MAX_SKILL_FILE_BYTES) })).length).toBe(MAX_SKILL_FILE_BYTES)
  })
})
