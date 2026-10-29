import { describe, expect, it } from 'vitest'
import { GENUI_FORMAT } from '../src/genui-contract.ts'
import { validateGenuiHtmlScripts } from '../src/genui-html-validation.ts'

const validate = (html: string) => validateGenuiHtmlScripts({ format: GENUI_FORMAT, title: 'Demo', items: [
  { type: 'card', title: 'Experiment', items: [{ type: 'html', title: 'Simulation', html, fallback: 'Description' }] },
] })

describe('Host HTML syntax validation', () => {
  it.each([
    '<script>var total=0;BIRTH vars computed var X=[];</script>',
    '<script>(function(){var points=[];for(i=ctxIdx(),mark>(P){…… }})()</script>',
    '<script>(function(){ var x=1;',
    '<button onclick="MC.add(">Add</button>',
  ])('rejects broken or incomplete scripts from repeated render attempts', html => {
    expect(validate(html)).toEqual([expect.objectContaining({ path: '$.items[0].items[0].html' })])
  })
  it('compiles without executing scripts or handlers, and permits return in a handler', () => {
    const before = (globalThis as Record<string, unknown>).__clawGenuiExecuted
    expect(validate('<script>globalThis.__clawGenuiExecuted=true;throw new Error("must not run")</script><button onclick="return false">Reset</button>')).toEqual([])
    expect((globalThis as Record<string, unknown>).__clawGenuiExecuted).toBe(before)
  })
  it('uses HTML parsing to ignore comments and data scripts instead of matching script-like text', () => {
    expect(validate('<!-- <script>bad code --><script type="application/json">{"name":"simulation"}</script><p>&lt;script&gt;</p><script>const value = 2 ** 3;</script>')).toEqual([])
  })
})
