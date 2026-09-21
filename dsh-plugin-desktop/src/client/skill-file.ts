export const MAX_SKILL_FILE_BYTES = 256 * 1024

export async function readSkillFile(file: Pick<File, 'name' | 'size' | 'text'>): Promise<string> {
  if (!/\.md$/iu.test(file.name)) throw new Error('fileType')
  if (file.size > MAX_SKILL_FILE_BYTES) throw new Error('fileTooLarge')
  const content = (await file.text()).replace(/^\uFEFF/u, '')
  if (new TextEncoder().encode(content).byteLength > MAX_SKILL_FILE_BYTES) throw new Error('fileTooLarge')
  if (content.trim() === '') throw new Error('fileEmpty')
  return content
}
