import { expect, it } from 'vitest'
import type { GenuiNode } from '../src/genui-contract.ts'
import { genuiLayout, genuiSurfaces } from '../src/client/genui-layout.ts'
const html: GenuiNode = { type: 'html', title: '交互', html: '<input>', fallback: '说明' }
const text: GenuiNode = { type: 'text', content: '文字' }

it('retains original addresses and order when multiple HTML fragments split nested groups', () => {
  const input: GenuiNode[] = [{ type: 'card', title: '外层', items: [text,
    { type: 'row', items: [html, { type: 'card', title: '内层', items: [text, html, text] }] }, text,
  ] }]
  const output = genuiLayout(input)
  expect(output.map(item => item.node.type)).toEqual(['card', 'html', 'card', 'html', 'card'])
  expect(output.filter(item => item.node.type === 'html').map(item => item.path)).toEqual(['0.1.0', '0.1.1.1'])
  expect(new Set(output.map(item => item.key)).size).toBe(output.length)
  function walk(nodes: ReturnType<typeof genuiLayout>) {
    for (const node of nodes) if (node.children) {
      expect(node.children.some(child => child.node.type === 'html')).toBe(false)
      walk(node.children)
    }
  }
  walk(output)
  expect(input[0]).toMatchObject({ items: [text, { items: [html, { items: [text, html, text] }] }, text] })
})
it('does not manufacture empty cards or rows around HTML-only wrappers', () => {
  const output = genuiLayout([{ type: 'card', title: '多余包装', items: [{ type: 'row', items: [html] }] }])
  expect(output).toEqual([{ node: html, key: '0.0.0', path: '0.0.0' }])
})
it('keeps narrative prose out of cards and structured cards independent', () => {
  const prose: GenuiNode = { type: 'card', title: '说明', items: [text] }
  const card: GenuiNode = { type: 'card', title: '统计', items: [{ type: 'stat', label: '样本', value: 100 }] }
  const output = genuiSurfaces(genuiLayout([text, text, html, prose, card, text]))
  expect(output.map(group => ({ kind: group.kind, types: group.nodes.map(item => item.node.type) }))).toEqual([
    { kind: 'prose', types: ['text', 'text'] }, { kind: 'independent', types: ['html'] },
    { kind: 'prose', types: ['card'] }, { kind: 'independent', types: ['card'] }, { kind: 'prose', types: ['text'] },
  ])
})
it('retains the row layout for independent ordinary data cards', () => {
  const card: GenuiNode = { type: 'card', title: '卡片', items: [{ type: 'stat', label: '样本', value: 100 }] }
  const output = genuiSurfaces(genuiLayout([{ type: 'row', items: [card, card] }]))
  expect(output).toHaveLength(1)
  expect(output[0]!.kind).toBe('independent')
  expect(output[0]!.nodes[0]!.node.type).toBe('row')
  expect(output[0]!.nodes[0]!.children?.map(item => item.node)).toEqual([card, card])
})
