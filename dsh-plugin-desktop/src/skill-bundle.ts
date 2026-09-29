import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, basename, resolve, relative, sep } from 'node:path'
import { MAX_SKILL_BUNDLE_BYTES, MAX_SKILL_BUNDLE_FILES, type DesktopSkillBundleFile, type DesktopSkillFile, type DesktopSkillFilePreview } from './skills-contract.ts'

export function skillBundlePath(path: string): string {
  if (path.length === 0 || path.length > 1024 || path.split('/').length > 17 || path.includes('\\') || /[\x00-\x1f:]/u.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part)
      || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part))) throw new Error('skillBundleInvalidPath')
  return path
}

export function decodeSkillBundle(value: unknown): readonly { path: string; data: Buffer }[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SKILL_BUNDLE_FILES) throw new Error('skillBundleLimit')
  let size = 0
  const seen = new Set<string>()
  const files = value.map((file: DesktopSkillBundleFile) => {
    if (!file || typeof file.path !== 'string' || typeof file.base64 !== 'string') throw new Error('skillBundleInvalidPath')
    const path = skillBundlePath(file.path)
    if (file.base64.length > Math.ceil(MAX_SKILL_BUNDLE_BYTES / 3) * 4) throw new Error('skillBundleLimit')
    const data = Buffer.from(file.base64, 'base64'); size += data.length
    if (data.toString('base64') !== file.base64) throw new Error('skillBundleInvalidPath')
    if (size > MAX_SKILL_BUNDLE_BYTES) throw new Error('skillBundleLimit')
    const key = path.normalize('NFC').toLowerCase()
    if (seen.has(key)) throw new Error('skillBundleInvalidPath')
    seen.add(key)
    return { path, data }
  })
  for (const path of seen) {
    const segments = path.split('/')
    for (let i = 1; i < segments.length; i++) if (seen.has(segments.slice(0, i).join('/'))) throw new Error('skillBundleInvalidPath')
  }
  if (!files.some(file => file.path === 'SKILL.md')) throw new Error('skillBundleMissingDocument')
  return files
}

export async function listSkillFiles(document: string): Promise<readonly DesktopSkillFile[]> {
  const target = await realpath(document)
  if (basename(document) !== 'SKILL.md') return [{ path: basename(document), size: (await lstat(target)).size, blocked: false }]
  const root = dirname(target)
  const files: DesktopSkillFile[] = []
  let visited = 0
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 16) throw new Error('skillBundleLimit')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++visited > MAX_SKILL_BUNDLE_FILES * 17) throw new Error('skillBundleLimit')
      const path = resolve(directory, entry.name)
      const info = await lstat(path)
      if (info.isDirectory()) await walk(path, depth + 1)
      else {
        if (files.length >= MAX_SKILL_BUNDLE_FILES) throw new Error('skillBundleLimit')
        files.push({ path: relative(root, path).split(sep).join('/'), size: info.size, blocked: !info.isFile() })
      }
    }
  }
  await walk(root, 0)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function previewSkillFile(document: string, path: string): Promise<DesktopSkillFilePreview> {
  skillBundlePath(path)
  const target = await realpath(document)
  if (basename(document) !== 'SKILL.md' && path !== basename(document)) throw new Error('skillBundleInvalidPath')
  const root = dirname(target)
  let candidate = root
  for (const part of path.split('/')) {
    candidate = resolve(candidate, part)
    if ((await lstat(candidate)).isSymbolicLink()) throw new Error('skillBundleInvalidPath')
  }
  const info = await lstat(candidate)
  if (!info.isFile() || info.size > 256 * 1024) return { path, unavailable: true }
  const data = await readFile(candidate)
  if (data.length > 256 * 1024 || data.includes(0)) return { path, unavailable: true }
  try { return { path, content: new TextDecoder('utf-8', { fatal: true }).decode(data), unavailable: false } }
  catch { return { path, unavailable: true } }
}
