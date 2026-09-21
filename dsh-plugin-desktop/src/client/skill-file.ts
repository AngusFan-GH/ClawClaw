import { MAX_SKILL_BUNDLE_BYTES, MAX_SKILL_BUNDLE_FILES, type DesktopSkillBundleFile } from '../skills-contract.ts'

export async function readSkillFolder(files: readonly File[]): Promise<readonly DesktopSkillBundleFile[]> {
  if (files.length === 0 || files.length > MAX_SKILL_BUNDLE_FILES || files.reduce((sum, file) => sum + file.size, 0) > MAX_SKILL_BUNDLE_BYTES) throw new Error('skillBundleLimit')
  const root = files[0]!.webkitRelativePath.split('/')[0]
  const result: DesktopSkillBundleFile[] = []
  let size = 0
  for (const file of files) {
    if (!root || !file.webkitRelativePath.startsWith(`${root}/`)) throw new Error('skillBundleInvalidPath')
    const path = file.webkitRelativePath.slice(root.length + 1)
    if (path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('skillBundleInvalidPath')
    const data = new Uint8Array(await file.arrayBuffer()); size += data.length
    if (size > MAX_SKILL_BUNDLE_BYTES) throw new Error('skillBundleLimit')
    let binary = ''
    for (let start = 0; start < data.length; start += 8192) binary += String.fromCharCode(...data.subarray(start, start + 8192))
    result.push({ path, base64: btoa(binary) })
  }
  if (!result.some(file => file.path === 'SKILL.md')) throw new Error('skillBundleMissingDocument')
  return result
}

export const MAX_SKILL_FILE_BYTES = 256 * 1024

export async function readSkillFile(file: Pick<File, 'name' | 'size' | 'text'>): Promise<string> {
  if (!/\.md$/iu.test(file.name)) throw new Error('fileType')
  if (file.size > MAX_SKILL_FILE_BYTES) throw new Error('fileTooLarge')
  const content = (await file.text()).replace(/^\uFEFF/u, '')
  if (new TextEncoder().encode(content).byteLength > MAX_SKILL_FILE_BYTES) throw new Error('fileTooLarge')
  if (content.trim() === '') throw new Error('fileEmpty')
  return content
}
