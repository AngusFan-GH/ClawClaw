import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('ClawClaw product copy', () => {
  it('brands the model thinking status in Chinese and English', () => {
    const source = readFileSync(new URL('../src/client/clawclaw-brand.tsx', import.meta.url), 'utf8')
    expect(source).toContain("['深度求索中...', '正在思考...']")
    expect(source).toContain("['Deep diving...', 'Thinking...']")
  })
})
