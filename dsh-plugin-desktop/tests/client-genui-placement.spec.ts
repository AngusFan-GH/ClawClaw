import { describe, expect, it } from 'vitest'
import { canPlaceGenuiText, inlineGenuiIds, splitGenuiText } from '../src/client/genui-placement.ts'

describe('inline visual references', () => {
  it('places standalone references between prose and decodes bounded IDs', () => {
    expect(splitGenuiText('原理\n\n[[clawclaw-ui:pi-demo]]\n\n误差\n[[clawclaw-ui:%E5%9B%BE%E8%A1%A8]]')).toEqual([
      { kind: 'text', text: '原理\n\n' }, { kind: 'result', id: 'pi-demo' },
      { kind: 'text', text: '\n误差\n' }, { kind: 'result', id: '图表' },
    ])
  })
  it.each(['```md\n[[clawclaw-ui:example]]\n```', '~~~\n[[clawclaw-ui:example]]\n~~~',
    '    [[clawclaw-ui:example]]', '> [[clawclaw-ui:example]]', '`[[clawclaw-ui:example]]`',
    '[[clawclaw-ui:%ZZ]]', `[[clawclaw-ui:${'a'.repeat(161)}]]`])('keeps literal/code examples intact: %s', text => {
    expect(splitGenuiText(text)).toEqual([{ kind: 'text', text }])
  })
  it.each(['pi', 'pi]'])('does not expose an unfinished streaming marker: %s', tail => {
    expect(splitGenuiText(`原理\n[[clawclaw-ui:${tail}`)).toEqual([{ kind: 'text', text: '原理\n' }, { kind: 'pending' }])
  })
  it('leaves reference-link and footnote documents in one native Markdown pass', () => {
    expect(canPlaceGenuiText('解释[^a]\n[[clawclaw-ui:demo]]\n[^a]: 来源')).toBe(false)
    expect(canPlaceGenuiText('[来源][a]\n[[clawclaw-ui:demo]]\n[a]: https://example.com')).toBe(false)
  })
  it('only consumes references from the settled public answer, never reasoning or tool commentary', () => {
    const assistants = [{ status: 'settled' as const, turn: 1, step: 1, time: 0,
      blocks: [{ kind: 'text' as const, text: '[[clawclaw-ui:process]]' }] },
    { status: 'settled' as const, turn: 1, step: 2, time: 0, blocks: [
      { kind: 'reasoning' as const, text: '[[clawclaw-ui:private]]' }, { kind: 'text' as const, text: '[[clawclaw-ui:answer]]' },
    ] }]
    expect([...inlineGenuiIds(assistants, 2)]).toEqual(['answer'])
    expect([...inlineGenuiIds(assistants, null)]).toEqual([])
  })
})
