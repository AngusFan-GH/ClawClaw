/**
 * Minimal, safe markdown renderer. Input is HTML-escaped first, then a small
 * whitelist of inline formatting and fenced code is applied — raw HTML/links
 * from the model can never inject into the DOM.
 */
export function renderMarkdown(input: string): string {
  const escaped = escapeHtml(input ?? '');
  const blocks = escaped.split(/```/);

  return blocks
    .map((part, index) => {
      if (index % 2 === 1) {
        // code fence: first line may be a language tag
        const body = part.replace(/^[a-zA-Z0-9_-]*\n/, '');
        return `<pre class="my-2 overflow-x-auto rounded-lg bg-black/90 p-3 text-xs text-emerald-200"><code>${body}</code></pre>`;
      }
      return part
        .split(/\n\n+/)
        .map((paragraph) => {
          const inline = paragraph
            .replace(/`([^`]+)`/g, '<code class="rounded bg-black/10 px-1 py-0.5 text-xs">$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>')
            .replace(/\n/g, '<br/>');
          return `<p class="my-1">${inline}</p>`;
        })
        .join('');
    })
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
