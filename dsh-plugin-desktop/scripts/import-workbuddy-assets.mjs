#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'

const sourceRoot = resolve(process.argv[2] ?? '')
const desktopRoot = resolve(import.meta.dirname, '..')
const skillOutput = join(desktopRoot, 'assets', 'skills')
const expertOutput = join(desktopRoot, 'assets', 'expert-plugins')
const sourceVersion = process.argv[3] ?? '5.7.10'
const TEXT_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.py', '.js', '.mjs', '.cjs', '.html', '.tpl', '.sh', '.cmd', '.gitignore'])
const COPY_EXTENSIONS = new Set([...TEXT_EXTENSIONS, '.png', '.jpg', '.jpeg'])
const EXCLUDED_SEGMENTS = new Set(['.codebuddy-plugin', '.workbuddy-plugin', '.git', 'node_modules', '__pycache__'])
const MAX_FILE_BYTES = 12 * 1024 * 1024

if (!sourceRoot || !existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
  console.error('Usage: node scripts/import-workbuddy-assets.mjs <extracted-workbuddy-builtin-root> [version]')
  process.exit(1)
}

const replacements = [
  [/CODEBUDDY_PLUGIN_ROOT/g, 'CLAWCLAW_PLUGIN_ROOT'],
  [/CODEBUDDY_PLUGIN_DATA/g, 'CLAWCLAW_PLUGIN_DATA'],
  [/CODEBUDDY_PROJECT_DIR/g, 'CLAWCLAW_PROJECT_DIR'],
  [/CODEBUDDY_SKILL_DIR/g, 'CLAWCLAW_SKILL_DIR'],
  [/CODEBUDDY_/g, 'CLAWCLAW_'],
  [/WORKBUDDY_/g, 'CLAWCLAW_'],
  [/\.codebuddy-plugin/g, '.clawclaw-plugin'],
  [/\.workbuddy-plugin/g, '.clawclaw-plugin'],
  [/scripts\/wb\//g, 'scripts/clawclaw/'],
  [/WBIPC/g, 'CLAWCLAW_IPC'],
  [/Wbipc/g, 'ClawClawIpc'],
  [/wbipc/g, 'clawclaw_ipc'],
  [/wb\.request/g, 'clawclaw.request'],
  [/CodeBuddy/g, 'ClawClaw'],
  [/codebuddy/g, 'clawclaw'],
  [/WorkBuddy/g, 'ClawClaw'],
  [/workbuddy/g, 'clawclaw'],
]

function adaptText(value) {
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

function extension(path) {
  const name = basename(path)
  if (name === '.gitignore') return '.gitignore'
  const index = name.lastIndexOf('.')
  return index < 0 ? '' : name.slice(index).toLowerCase()
}

function walk(root, callback) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || EXCLUDED_SEGMENTS.has(entry.name)) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) walk(path, callback)
    else if (entry.isFile()) callback(path)
  }
}

function skillMetadata(path) {
  const source = readFileSync(path, 'utf8')
  const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? ''
  const declaredName = header.match(/^name:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1]?.trim()
  const description = header.match(/^description:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1]?.trim()
  const fallbackName = adaptText(basename(dirname(path))).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const adaptedName = adaptText(declaredName ?? '')
  const name = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(adaptedName) ? adaptedName : fallbackName
  if (!name) throw new Error(`Cannot migrate Skill with invalid name: ${path}`)
  return { name, description: adaptText(description ?? `${declaredName ?? name} migrated capability`) }
}

function copyPortableTree(source, target, nestedSkillRoots = new Set()) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || EXCLUDED_SEGMENTS.has(entry.name)) continue
    const input = join(source, entry.name)
    const outputName = entry.name === 'wb' ? 'clawclaw' : adaptText(entry.name)
    if (entry.isDirectory()) {
      if (nestedSkillRoots.has(input)) continue
      copyPortableTree(input, join(target, outputName), nestedSkillRoots)
      continue
    }
    if (!entry.isFile() || !COPY_EXTENSIONS.has(extension(input)) || statSync(input).size > MAX_FILE_BYTES) continue
    const output = join(target, outputName)
    if (TEXT_EXTENSIONS.has(extension(input))) writeFileSync(output, adaptText(readFileSync(input, 'utf8')))
    else cpSync(input, output)
  }
}

const skillFiles = []
walk(sourceRoot, path => { if (basename(path) === 'SKILL.md') skillFiles.push(path) })
const skillRoots = new Set(skillFiles.map(dirname))
const migratedSkills = []
for (const skillFile of skillFiles.sort()) {
  const metadata = skillMetadata(skillFile)
  if (metadata.name === 'expert-manager') continue
  const target = join(skillOutput, metadata.name)
  if (existsSync(target)) {
    const marker = join(target, 'SOURCE.json')
    if (!existsSync(marker)) throw new Error(`Refusing to replace non-imported Skill: ${target}`)
    rmSync(target, { recursive: true })
  }
  const source = dirname(skillFile)
  const nested = new Set([...skillRoots].filter(candidate => candidate !== source && dirname(candidate).startsWith(`${source}/`)))
  copyPortableTree(source, target, nested)
  const targetSkill = join(target, 'SKILL.md')
  const normalizedSkill = readFileSync(targetSkill, 'utf8')
    .replace(/^name:\s*.*$/m, `name: ${metadata.name}`)
    .replace(/^description:\s+([^>|].*)$/m, (_line, value) => `description: ${JSON.stringify(value.replace(/^["']|["']$/g, ''))}`)
    .replace(/^description_en:\s+([^>|].*)$/m, (_line, value) => `description_en: ${JSON.stringify(value.replace(/^["']|["']$/g, ''))}`)
  writeFileSync(targetSkill, normalizedSkill)
  const sourceRecord = {
    sourceProduct: 'WorkBuddy AI',
    sourceVersion,
    sourceAsset: relative(sourceRoot, source).split('\\').join('/'),
    importedAs: metadata.name,
    migration: 'ClawClaw-owned portable copy',
    license: existsSync(join(source, 'LICENSE.txt')) ? 'See LICENSE.txt' : 'Not declared in source asset',
    runtimeDependency: 'No WorkBuddy filesystem dependency',
  }
  writeFileSync(join(target, 'SOURCE.json'), `${JSON.stringify(sourceRecord, null, 2)}\n`)
  migratedSkills.push(metadata.name)
}

function inlineWelcomeAgent(path) {
  let source = readFileSync(path, 'utf8')
  const include = source.match(/\{%\s*include\s+["']welcomemode-(code|design|work)\/prompt\.tpl["']\s*%\}/)
  if (include) source = source.replace(include[0], readFileSync(join(sourceRoot, 'welcomemode', include[1], 'prompt.tpl'), 'utf8'))
  return adaptText(source)
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function resetGeneratedPackage(name) {
  const target = join(expertOutput, name)
  if (existsSync(target)) {
    const marker = join(target, 'SOURCE.json')
    if (!existsSync(marker)) throw new Error(`Refusing to replace non-imported expert package: ${target}`)
    rmSync(target, { recursive: true })
  }
  mkdirSync(join(target, '.clawclaw-plugin'), { recursive: true })
  mkdirSync(join(target, 'agents'), { recursive: true })
  return target
}

function singleAgentPackage({ packageName, agentId, expertName, description, source, avatar }) {
  const target = resetGeneratedPackage(packageName)
  writeFileSync(join(target, 'agents', `${agentId}.md`), inlineWelcomeAgent(source))
  writeJson(join(target, '.clawclaw-plugin', 'plugin.json'), {
    name: packageName, version: sourceVersion, description, author: 'ClawClaw migration',
    agents: [`./agents/${agentId}.md`], expertType: 'agent', agentName: agentId,
    profession: { zh: expertName.zh, en: expertName.en },
    displayDescription: { zh: description, en: description }, avatar, categoryId: '12-IndustryConsultant',
    defaultInitPrompt: { zh: `请以${expertName.zh}身份处理当前任务。`, en: `Handle this task as ${expertName.en}.` },
    tags: [{ zh: '内置迁移', en: 'Built-in' }, { zh: '专业工作流', en: 'Workflow' }, { zh: '本地资产', en: 'Local asset' }],
    quickPrompts: [{ zh: '分析当前任务并给出执行方案', en: 'Analyze the task and propose an execution plan' }, { zh: '直接开始完成当前任务', en: 'Start completing the task' }, { zh: '复核结果并指出风险', en: 'Review the result and identify risks' }],
  })
  writeJson(join(target, 'SOURCE.json'), { sourceProduct: 'WorkBuddy AI', sourceVersion, sourceAsset: relative(sourceRoot, source), migration: 'ClawClaw-owned Agent package', runtimeDependency: 'No WorkBuddy filesystem dependency' })
}

singleAgentPackage({ packageName: 'migrated-code-expert', agentId: 'code', expertName: { zh: '代码专家', en: 'Code Expert' }, description: '面向代码分析、实现、调试和交付的工程专家。', source: join(sourceRoot, 'welcomemode', 'code', 'agents', 'code.md'), avatar: 4 })
singleAgentPackage({ packageName: 'migrated-design-expert', agentId: 'design', expertName: { zh: '设计专家', en: 'Design Expert' }, description: '面向产品体验、视觉系统和设计交付的设计专家。', source: join(sourceRoot, 'welcomemode', 'design', 'agents', 'design.md'), avatar: 7 })
singleAgentPackage({ packageName: 'migrated-work-expert', agentId: 'work', expertName: { zh: '工作助理专家', en: 'Work Expert' }, description: '面向研究、写作、整理与日常业务执行的通用专家。', source: join(sourceRoot, 'welcomemode', 'work', 'agents', 'work.md'), avatar: 1 })
singleAgentPackage({ packageName: 'migrated-spreadsheet-expert', agentId: 'sheet-agent', expertName: { zh: '表格专家', en: 'Spreadsheet Expert' }, description: '面向电子表格读取、分析、清洗、公式和可视化的专家。', source: join(sourceRoot, 'builtin-plugins', 'sheetagent', 'agents', 'sheet-agent.md'), avatar: 9 })

const documentTeam = resetGeneratedPackage('migrated-document-production-team')
const documentAgentsRoot = join(sourceRoot, 'builtin-plugins', 'tencent-docx', 'agents')
for (const id of ['doc-writer', 'doc-formatter', 'doc-converter']) writeFileSync(join(documentTeam, 'agents', `${id}.md`), adaptText(readFileSync(join(documentAgentsRoot, `${id}.md`), 'utf8')))
writeJson(join(documentTeam, '.clawclaw-plugin', 'plugin.json'), {
  name: 'migrated-document-production-team', version: sourceVersion, description: '文档内容创作、排版审校与 DOCX 交付专家团。', author: 'ClawClaw migration',
  agents: ['./agents/doc-writer.md', './agents/doc-formatter.md', './agents/doc-converter.md'], expertType: 'team', agentName: 'doc-writer',
  teamInfo: { leadAgent: 'doc-writer', memberAgents: ['doc-formatter', 'doc-converter'] },
  members: [
    { id: 'doc-writer', profession: { zh: '文档主笔', en: 'Document Writer' }, avatar: 3, role: 'lead' },
    { id: 'doc-formatter', profession: { zh: '排版设计师', en: 'Document Formatter' }, avatar: 7, role: 'member' },
    { id: 'doc-converter', profession: { zh: '文档交付工程师', en: 'Document Converter' }, avatar: 1, role: 'member' },
  ],
  profession: { zh: '文档生产专家团', en: 'Document Production Team' },
  displayDescription: { zh: '由主笔、排版设计师和交付工程师协作完成专业文档。', en: 'A writer, formatter, and delivery engineer collaborate on professional documents.' },
  avatar: 3, categoryId: '06-ContentCreative', defaultInitPrompt: { zh: '先明确文档目标与受众，再由主笔创作、排版设计师优化、交付工程师校验并汇总。', en: 'Clarify the document goal and audience, then coordinate writing, formatting, validation, and final delivery.' },
  tags: [{ zh: '文档', en: 'Documents' }, { zh: '写作', en: 'Writing' }, { zh: '排版', en: 'Formatting' }],
  quickPrompts: [{ zh: '创建一份结构完整的专业报告', en: 'Create a complete professional report' }, { zh: '优化现有文档的内容和排版', en: 'Improve the content and layout of an existing document' }, { zh: '检查文档质量并生成可交付版本', en: 'Review document quality and produce a deliverable version' }],
})
writeJson(join(documentTeam, 'SOURCE.json'), { sourceProduct: 'WorkBuddy AI', sourceVersion, sourceAsset: 'builtin-plugins/tencent-docx/agents', migration: 'ClawClaw-owned Team package', runtimeDependency: 'No WorkBuddy filesystem dependency' })

writeJson(join(skillOutput, 'MIGRATION_MANIFEST.json'), {
  sourceProduct: 'WorkBuddy AI', sourceVersion,
  skills: migratedSkills.sort(),
  expertPackages: ['migrated-code-expert', 'migrated-design-expert', 'migrated-work-expert', 'migrated-spreadsheet-expert', 'migrated-document-production-team'],
  excluded: ['credentials', 'signatures', 'native binaries', 'private MCP runtime bundles', 'subscription gates'],
  runtimeIsolation: 'Packaged ClawClaw assets and DSH_HOME only',
})

console.log(`Imported ${migratedSkills.length} Skills and 5 expert packages into ClawClaw-owned assets.`)
