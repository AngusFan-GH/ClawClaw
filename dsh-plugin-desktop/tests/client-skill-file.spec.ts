import { describe, expect, it } from 'vitest'
import { MAX_SKILL_FILE_BYTES, readSkillFile, readSkillFolder } from '../src/client/skill-file.ts'

describe('Skill file selection', () => {
  it('preserves relative paths and binary bytes in folder imports', async () => {
    const file = (webkitRelativePath: string, bytes: Uint8Array) => ({ webkitRelativePath, size: bytes.length, arrayBuffer: async () => bytes.buffer }) as File
    const result = await readSkillFolder([file('review/SKILL.md', new TextEncoder().encode('Document')), file('review/assets/pixel.bin', new Uint8Array([0, 128, 255]))])
    expect(result.map(item => item.path)).toEqual(['SKILL.md', 'assets/pixel.bin'])
    expect(Buffer.from(result[1]!.base64, 'base64')).toEqual(Buffer.from([0, 128, 255]))
    await expect(readSkillFolder([file('review/scripts/a.py', new Uint8Array())])).rejects.toThrow('skillBundleMissingDocument')
    const hidden = await readSkillFolder([file('.review/SKILL.md', new Uint8Array()), file('.review/.config/.settings.json', new Uint8Array([123, 125]))])
    expect(hidden.map(item => item.path)).toEqual(['SKILL.md', '.config/.settings.json'])
    await expect(readSkillFolder([file('review/../outside', new Uint8Array())])).rejects.toThrow('skillBundleInvalidPath')
  })
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
