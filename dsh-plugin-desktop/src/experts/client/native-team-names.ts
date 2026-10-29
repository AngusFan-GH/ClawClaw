// @ts-nocheck -- ported client compatibility layer; host contracts remain strictly checked.
import type { ExpertSummary } from '../expert-contract.js'

/** Old phase labels are persisted in subagent catalogs, independently of new-run naming. */
export function legacyExpertTeamNames(experts: readonly ExpertSummary[], locale: 'zh' | 'en'): Map<string, string> {
  const labels = new Map<string, string>()
  for (const expert of experts) {
    if (expert.packageType !== 'team' || expert.conflict) continue
    const shown = locale === 'en' ? expert.nameEn : expert.name
    for (const name of new Set([expert.name, expert.nameEn])) {
      for (const phase of ['规划', '成稿', '执行', '汇总', 'Planning', 'Writing', 'Working', 'Synthesis']) {
        labels.set(`${name} · ${phase}`, shown)
      }
    }
  }
  return labels
}

/** Adapt only name leaves in native rosters and subagent navigation; preserve click targets. */
export function installNativeTeamNames(loadLabels: () => Promise<ReadonlyMap<string, string>>, onError: (error: unknown) => void) {
  const selector = '[class$="_roster"] > button > span[class$="_memberText"] > span:first-child, [role="treeitem"] > [class*="_clickarea"] > [class*="_content"] > span:first-child, span[class*="_switcherTitle"]'
  const tracked = new Map<Text, { original: string; shown: string }>()
  const attributes = new Map<Element, { original: string; shown: string }>()
  const seen = new WeakMap<Text, string>()
  let labels: ReadonlyMap<string, string> = new Map()
  let disposed = false
  let generation = 0
  const scan = (): boolean => {
    let added = false
    for (const [node] of tracked) if (!node.isConnected) tracked.delete(node)
    for (const [element] of attributes) if (!element.isConnected) attributes.delete(element)
    for (const element of document.querySelectorAll(selector)) {
      const node = element.firstChild
      if (!(node instanceof Text) || element.childNodes.length !== 1) continue
      const old = tracked.get(node)
      const original = old && node.data === old.shown ? old.original : node.data
      if (!/^agency-[a-z0-9-]+-[0-9a-f]{10}$/u.test(original) && !/^.+ · (?:规划|成稿|执行|汇总|Planning|Writing|Working|Synthesis)$/u.test(original)) { tracked.delete(node); continue }
      if (seen.get(node) !== original) { seen.set(node, original); added = true }
      const shown = labels.get(original) ?? original
      tracked.set(node, { original, shown })
      // 修改原文字节点，保留 React 持有的节点和事件绑定。
      if (node.data !== shown) node.data = shown
    }
    for (const element of document.querySelectorAll('[role="treeitem"][aria-label], [role="treeitem"] button[aria-label], button[aria-label]:has([class*="_switcherTitle"])')) {
      const value = element.getAttribute('aria-label') ?? ''
      const old = attributes.get(element)
      const original = old && value === old.shown ? old.original : value
      let shown = original
      for (const [name, label] of labels) if (shown.includes(name)) shown = shown.replaceAll(name, label)
      attributes.set(element, { original, shown })
      if (value !== shown) element.setAttribute('aria-label', shown)
    }
    return added
  }
  const refresh = async () => {
    const current = ++generation
    try {
      const next = await loadLabels()
      if (disposed || current !== generation) return
      labels = next
      scan()
    } catch (error) { if (!disposed && current === generation) onError(error) }
  }
  const observer = new MutationObserver(() => { if (scan()) void refresh() })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] })
  if (scan()) void refresh()
  return {
    refresh,
    dispose() {
      disposed = true
      observer.disconnect()
      for (const [node, value] of tracked) if (node.data === value.shown) node.data = value.original
      for (const [element, value] of attributes) if (element.getAttribute('aria-label') === value.shown) element.setAttribute('aria-label', value.original)
      tracked.clear()
      attributes.clear()
    },
  }
}
