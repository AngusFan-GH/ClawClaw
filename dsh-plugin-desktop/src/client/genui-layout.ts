import type { GenuiNode } from '../genui-contract.ts'

/** Presentation addresses always refer to the original saved document. */
export interface GenuiLayoutNode {
  node: GenuiNode
  path: string
  key: string
  children?: GenuiLayoutNode[]
  continuation?: boolean
}

/** Lift HTML out of card/row wrappers without reordering content or changing state addresses. */
export function genuiLayout(nodes: readonly GenuiNode[], prefix = ''): GenuiLayoutNode[] {
  return nodes.flatMap((node, index): GenuiLayoutNode[] => {
    const path = prefix ? `${prefix}.${index}` : String(index)
    if (node.type !== 'card' && node.type !== 'row') return [{ node, path, key: path }]
    const children = genuiLayout(node.items, path)
    if (!children.some(child => child.node.type === 'html')) return [{ node, path, key: path, children }]
    const output: GenuiLayoutNode[] = []
    let pending: GenuiLayoutNode[] = []
    let segments = 0
    const flush = () => {
      if (!pending.length) return
      output.push({ node, path, key: `${path}:${pending[0]!.key}`, children: pending, continuation: segments++ > 0 })
      pending = []
    }
    for (const child of children) {
      if (child.node.type === 'html') { flush(); output.push(child) }
      else pending.push(child)
    }
    flush()
    return output
  })
}

export interface GenuiSurface {
  kind: 'prose' | 'independent' | 'content'
  nodes: GenuiLayoutNode[]
}

/** Text-only groups keep their heading and reading order without another card shell. */
function proseOnly(entry: GenuiLayoutNode): boolean {
  return entry.node.type === 'text' || (entry.node.type === 'card' || entry.node.type === 'row')
    && !!entry.children?.length && entry.children.every(proseOnly)
}

function surfaceKind(entry: GenuiLayoutNode): GenuiSurface['kind'] {
  if (proseOnly(entry)) return 'prose'
  return entry.node.type === 'html' || entry.node.type === 'card'
    || entry.node.type === 'row' && entry.children?.every(child => child.node.type === 'card')
    ? 'independent' : 'content'
}

/** Preserve semantic groups; do not frame narrative text merely because it accompanies a visual. */
export function genuiSurfaces(nodes: readonly GenuiLayoutNode[]): GenuiSurface[] {
  const groups: GenuiSurface[] = []
  for (const node of nodes) {
    const kind = surfaceKind(node)
    const previous = groups.at(-1)
    if (kind !== 'independent' && previous?.kind === kind) previous.nodes.push(node)
    else groups.push({ kind, nodes: [node] })
  }
  return groups
}
