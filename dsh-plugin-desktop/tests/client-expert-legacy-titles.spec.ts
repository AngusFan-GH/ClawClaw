// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { ExpertSummary } from '../src/experts/expert-contract.ts'
import { installNativeTeamNames, legacyExpertTeamNames } from '../src/experts/client/native-team-names.ts'

const expert = { slug: 'documents--lead', name: '文档主笔', nameEn: 'Document Lead', packageType: 'team' } as ExpertSummary
let adapter: ReturnType<typeof installNativeTeamNames> | undefined
afterEach(() => { adapter?.dispose(); adapter = undefined; document.body.replaceChildren() })

it('removes persisted phase suffixes in navigation without changing the row or its click behavior', async () => {
  document.body.innerHTML = '<div role="tree"><div role="treeitem" aria-label="文档主笔 · 成稿 已完成"><div class="_clickarea_hash"><span class="_content_hash"><span class="_label_hash">文档主笔 · 成稿</span><span>Task description · 已完成</span></span><button aria-label="打开 文档主笔 · 成稿"></button></div></div></div><p>文档主笔 · 成稿</p>'
  const row = document.querySelector('[role="treeitem"]')!
  const label = document.querySelector('._label_hash')!.firstChild
  const clicked = vi.fn(); row.addEventListener('click', clicked)
  adapter = installNativeTeamNames(async () => legacyExpertTeamNames([expert], 'zh'), error => { throw error })
  await vi.waitFor(() => expect(label?.textContent).toBe('文档主笔'))
  expect(document.querySelector('._label_hash')!.firstChild).toBe(label)
  expect(row.getAttribute('aria-label')).toBe('文档主笔 已完成')
  expect(document.querySelector('button')!.getAttribute('aria-label')).toBe('打开 文档主笔')
  expect(document.querySelector('p')!.textContent).toBe('文档主笔 · 成稿')
  row.dispatchEvent(new MouseEvent('click')); expect(clicked).toHaveBeenCalledOnce()
  adapter.dispose(); adapter = undefined
  expect(label?.textContent).toBe('文档主笔 · 成稿')
  expect(row.getAttribute('aria-label')).toBe('文档主笔 · 成稿 已完成')
})

it('supports historical Chinese and English labels and newly opened dropdowns after locale changes', async () => {
  let locale: 'zh' | 'en' = 'zh'
  adapter = installNativeTeamNames(async () => legacyExpertTeamNames([expert], locale), error => { throw error })
  document.body.innerHTML = '<div role="treeitem"><div class="_clickarea_hash"><span class="_content_hash"><span>Document Lead · Synthesis</span></span></div></div>'
  await vi.waitFor(() => expect(document.querySelector('span > span')!.textContent).toBe('文档主笔'))
  locale = 'en'; await adapter.refresh()
  expect(document.querySelector('span > span')!.textContent).toBe('Document Lead')
})

it('does not rewrite ordinary agents or user content with similar suffixes', async () => {
  const labels = legacyExpertTeamNames([{ ...expert, packageType: 'agent' }, { ...expert, conflict: true }], 'zh')
  expect(labels.size).toBe(0)
  document.body.innerHTML = '<div role="treeitem"><div class="_clickarea_hash"><span class="_content_hash"><span>普通助手 · 执行</span></span></div></div>'
  adapter = installNativeTeamNames(async () => legacyExpertTeamNames([expert], 'zh'), error => { throw error })
  await adapter.refresh()
  expect(document.querySelector('span > span')!.textContent).toBe('普通助手 · 执行')
})
