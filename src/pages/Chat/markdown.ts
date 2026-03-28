import DOMPurify from 'dompurify';
import { marked } from 'marked';

const allowedTags = [
  'a', 'b', 'blockquote', 'br', 'button', 'code', 'del', 'details', 'div', 'em', 'h1', 'h2', 'h3', 'h4',
  'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'summary', 'table', 'tbody', 'td', 'th',
  'thead', 'tr', 'ul',
];
const allowedAttrs = ['class', 'href', 'rel', 'target', 'title', 'start', 'src', 'alt', 'data-code', 'type', 'aria-label'];
const sanitizeOptions = {
  ALLOWED_TAGS: allowedTags,
  ALLOWED_ATTR: allowedAttrs,
  ADD_DATA_URI_TAGS: ['img'],
};

const MARKDOWN_CHAR_LIMIT = 140_000;
const MARKDOWN_PARSE_LIMIT = 40_000;
const MARKDOWN_CACHE_LIMIT = 200;
const MARKDOWN_CACHE_MAX_CHARS = 50_000;
const INLINE_DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;
const markdownCache = new Map<string, string>();

let markdownHooksInstalled = false;

function truncateText(value: string, max: number): { text: string; truncated: boolean; total: number } {
  if (value.length <= max) {
    return { text: value, truncated: false, total: value.length };
  }
  return {
    text: value.slice(0, Math.max(0, max)),
    truncated: true,
    total: value.length,
  };
}

function getCachedMarkdown(key: string): string | null {
  const cached = markdownCache.get(key);
  if (cached === undefined) {
    return null;
  }
  markdownCache.delete(key);
  markdownCache.set(key, cached);
  return cached;
}

function setCachedMarkdown(key: string, value: string): void {
  markdownCache.set(key, value);
  if (markdownCache.size <= MARKDOWN_CACHE_LIMIT) {
    return;
  }
  const oldest = markdownCache.keys().next().value;
  if (oldest) {
    markdownCache.delete(oldest);
  }
}

function installMarkdownHooks(): void {
  if (markdownHooksInstalled) {
    return;
  }
  markdownHooksInstalled = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof HTMLAnchorElement)) {
      return;
    }
    const href = node.getAttribute('href');
    if (!href) {
      return;
    }

    try {
      const url = new URL(href, window.location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') {
        node.removeAttribute('href');
        return;
      }
    } catch {
      // Relative URLs are fine; DOMPurify still strips dangerous schemes.
    }

    node.setAttribute('rel', 'noreferrer noopener');
    node.setAttribute('target', '_blank');
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEscapedPlainTextHtml(value: string): string {
  return `<div class="markdown-plain-text-fallback">${escapeHtml(value.replace(/\r\n?/g, '\n'))}</div>`;
}

const htmlEscapeRenderer = new marked.Renderer();
htmlEscapeRenderer.html = ({ text }) => escapeHtml(text);
htmlEscapeRenderer.image = ({ href, text }) => {
  const label = text?.trim() || 'image';
  const safeHref = href?.trim() ?? '';
  if (!INLINE_DATA_IMAGE_RE.test(safeHref)) {
    return escapeHtml(label);
  }
  return `<img class="markdown-inline-image" src="${escapeHtml(safeHref)}" alt="${escapeHtml(label)}">`;
};
htmlEscapeRenderer.code = ({ text, lang, escaped }) => {
  const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
  const safeText = escaped ? text : escapeHtml(text);
  const codeBlock = `<pre><code${langClass}>${safeText}</code></pre>`;
  const langLabel = lang ? `<span class="code-block-lang">${escapeHtml(lang)}</span>` : '';
  const attrSafe = text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const copyBtn = `<button type="button" class="code-block-copy" data-code="${attrSafe}" aria-label="Copy code"><span class="code-block-copy__idle">Copy</span><span class="code-block-copy__done">Copied!</span></button>`;
  const header = `<div class="code-block-header">${langLabel}${copyBtn}</div>`;

  const trimmed = text.trim();
  const isJson =
    lang === 'json'
    || (!lang
      && ((trimmed.startsWith('{') && trimmed.endsWith('}'))
        || (trimmed.startsWith('[') && trimmed.endsWith(']'))));

  if (isJson) {
    const lineCount = text.split('\n').length;
    const label = lineCount > 1 ? `JSON &middot; ${lineCount} lines` : 'JSON';
    return `<details class="json-collapse"><summary>${label}</summary><div class="code-block-wrapper">${header}${codeBlock}</div></details>`;
  }

  return `<div class="code-block-wrapper">${header}${codeBlock}</div>`;
};

export function toSanitizedMarkdownHtml(markdown: string): string {
  const input = markdown.trim();
  if (!input) {
    return '';
  }

  installMarkdownHooks();
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    const cached = getCachedMarkdown(input);
    if (cached !== null) {
      return cached;
    }
  }

  const truncated = truncateText(input, MARKDOWN_CHAR_LIMIT);
  const suffix = truncated.truncated
    ? `\n\n… truncated (${truncated.total} chars, showing first ${truncated.text.length}).`
    : '';

  if (truncated.text.length > MARKDOWN_PARSE_LIMIT) {
    const html = renderEscapedPlainTextHtml(`${truncated.text}${suffix}`);
    const sanitized = DOMPurify.sanitize(html, sanitizeOptions);
    if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
      setCachedMarkdown(input, sanitized);
    }
    return sanitized;
  }

  let rendered: string;
  try {
    rendered = marked.parse(`${truncated.text}${suffix}`, {
      renderer: htmlEscapeRenderer,
      gfm: true,
      breaks: true,
    }) as string;
  } catch (err) {
    console.warn('[markdown] marked.parse failed, falling back to plain text:', err);
    rendered = `<pre class="code-block">${escapeHtml(`${truncated.text}${suffix}`)}</pre>`;
  }

  const sanitized = DOMPurify.sanitize(rendered, sanitizeOptions);
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    setCachedMarkdown(input, sanitized);
  }
  return sanitized;
}
