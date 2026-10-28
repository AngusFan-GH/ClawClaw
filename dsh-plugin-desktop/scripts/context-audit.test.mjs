import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { recordContextAudit } from './context-audit.mjs'

test('offline audit preserves attribution while redacting paths, endpoints and credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawclaw-context-audit-'))
  const previous = process.env.CLAWCLAW_CONTEXT_AUDIT_PATH
  try {
    process.env.CLAWCLAW_CONTEXT_AUDIT_PATH = join(root, 'audit.jsonl')
    recordContextAudit('fixture', { assembly: {
      sections: [{ name: 'clawclaw:product-context', text: 'Bearer sensitive-token /Users/example/private/project' }],
      contexts: [{ name: 'working-directory:current', text: 'http://127.0.0.1:43120 /tmp/private-project' }],
      tools: [{ name: 'read', description: 'api_key=hidden-key' }],
    }, request: { messages: [{ role: 'user', source: { kind: 'time-context', form: 'snapshot', sections: [{ name: 'time-context' }] },
      content: [{ type: 'text', text: '当前日期与时区。' }] }] } })
    const raw = readFileSync(process.env.CLAWCLAW_CONTEXT_AUDIT_PATH, 'utf8')
    assert.doesNotMatch(raw, /sensitive-token|hidden-key|example\/private|private-project|43120/)
    const record = JSON.parse(raw)
    assert.equal(record.sections[0].owner, 'desktop')
    assert.equal(record.contexts[0].owner, 'upstream-or-preset')
    assert.deepEqual(record.messages[0], { role: 'user', source: 'time-context', form: 'snapshot', sections: ['time-context'], text: '当前日期与时区。' })
    assert.equal(record.tools[0].name, 'read')
  } finally {
    if (previous === undefined) delete process.env.CLAWCLAW_CONTEXT_AUDIT_PATH
    else process.env.CLAWCLAW_CONTEXT_AUDIT_PATH = previous
    rmSync(root, { recursive: true, force: true })
  }
})
