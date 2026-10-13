import { describe, expect, it } from 'vitest'
import {
  parseSelectionSideChatRequest,
  SELECTION_SIDECHAT_MAX_CHARS,
  SELECTION_SIDECHAT_MAX_HISTORY,
  selectionSideChatToolFilter,
  selectionSideChatPrompt,
} from '../src/selection-sidechat.ts'

describe('selection side chat', () => {
  it('bounds selection and history at the host boundary', () => {
    const request = parseSelectionSideChatRequest({
      sessionId: 'session-1',
      selection: `  ${'x'.repeat(SELECTION_SIDECHAT_MAX_CHARS + 50)}  `,
      question: ' explain ',
      history: Array.from({ length: SELECTION_SIDECHAT_MAX_HISTORY + 3 }, (_, index) => ({ question: `q${index}`, answer: `a${index}` })),
    })
    expect(request.selection).toHaveLength(SELECTION_SIDECHAT_MAX_CHARS)
    expect(request.question).toBe('explain')
    expect(request.history).toHaveLength(SELECTION_SIDECHAT_MAX_HISTORY)
    expect(request.history[0]?.question).toBe('q3')
  })

  it('builds an isolated reading prompt with prior side-chat turns', () => {
    const request = parseSelectionSideChatRequest({
      sessionId: 'session-1', selection: 'quoted context', question: 'Why?',
      history: [{ question: 'What?', answer: 'A prior answer.' }],
    })
    const prompt = selectionSideChatPrompt(request)
    expect(prompt).toContain('<quote>\nquoted context\n</quote>')
    expect(prompt).toContain('用户：What?')
    expect(prompt).toContain('助手：A prior answer.')
    expect(prompt).toContain('当前问题：Why?')
    expect(prompt).toContain('不要修改文件')
  })

  it('intersects the read-only allowlist with the live tool registry', () => {
    const filter = selectionSideChatToolFilter({
      get: () => ({ schemas: () => [{ name: 'read' }, { name: 'bash' }, { name: 'web_fetch' }] }),
    } as never)
    expect(filter).toEqual({ allow: ['read', 'web_fetch'] })
    expect(selectionSideChatToolFilter({ get: () => undefined } as never)).toBeUndefined()
  })

  it.each([
    null,
    {},
    { sessionId: '', selection: 'text', question: 'why', history: [] },
    { sessionId: 's', selection: '', question: 'why', history: [] },
    { sessionId: 's', selection: 'text', question: '', history: [] },
    { sessionId: 's', selection: 'text', question: 'why', history: [{}] },
  ])('rejects malformed requests %#', value => {
    expect(() => parseSelectionSideChatRequest(value)).toThrow('Invalid side-chat')
  })
})
