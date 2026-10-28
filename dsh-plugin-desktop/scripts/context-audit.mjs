/** Opt-in, redacted request evidence from disposable offline profile smokes only. */
import { appendFileSync } from 'node:fs'

function redact(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item !== 'string' ? item : item
    .replace(/(?:Bearer\s+|(?:api[_-]?key|token|password|secret)[=:]\s*)[^\s"']+/gi, '<credential>')
    .replace(/https?:\/\/[^\s"'<>]+/g, '<url>')
    .replace(/(?:\/(?:Users|Volumes|private|tmp|var)\/|[A-Z]:\\)[^\s"'<>]+/g, '<path>')))
}

/** Attribute prompt sections and wire messages without inspecting real user Profiles. */
export function recordContextAudit(label, { assembly, request } = {}) {
  const path = process.env.CLAWCLAW_CONTEXT_AUDIT_PATH
  if (!path) return
  const sections = entries => entries?.map(({ name, text }) => ({
    name, owner: /^(clawclaw:|agency:|desktop-)/.test(name) ? 'desktop' : 'upstream-or-preset', text,
  }))
  appendFileSync(path, JSON.stringify(redact({
    label,
    sections: sections(assembly?.sections), contexts: sections(assembly?.contexts),
    tools: (request?.tools ?? assembly?.tools)?.map(({ name, description }) => ({ name, description })),
    messages: request?.messages.map(({ role, source, content }) => ({
      role, source: source?.kind, form: source?.form,
      sections: source?.sections?.map(({ name }) => name),
      text: content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
    })),
  })) + '\n', { mode: 0o600 })
}
