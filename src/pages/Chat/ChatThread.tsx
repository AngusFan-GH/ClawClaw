import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Bot, Check, Copy, User, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RawMessage, StreamSegment } from '@/stores/chat';
import { extractImages, extractText, extractThinking } from './message-utils';
import { useTranslation } from 'react-i18next';

type ToolCard = {
  kind: 'call' | 'result';
  name: string;
  args?: unknown;
  text?: string;
};

type ToolDisplay = {
  label: string;
  detail?: string;
};

type ChatThreadLabels = {
  codeCopy: string;
  codeCopied: string;
  json: string;
  toolOutput: string;
  reasoning: string;
  you: string;
  assistant: string;
  tool: string;
  tokenInputPrefix: string;
  tokenOutputPrefix: string;
  cacheReadPrefix: string;
  cacheWritePrefix: string;
  contextSuffix: string;
  completed: string;
  view: string;
  toolCount: (count: number) => string;
  process: string;
  read: string;
  exec: string;
};

type ChatItem =
  | { kind: 'message'; key: string; message: RawMessage }
  | { kind: 'stream'; key: string; text: string; startedAt: number }
  | { kind: 'reading-indicator'; key: string };

type MessageGroup = {
  kind: 'group';
  key: string;
  role: string;
  messages: Array<{ key: string; message: RawMessage }>;
  timestamp: number;
};

type GroupMeta = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  model: string | null;
  contextPercent: number | null;
};

function getMessageKey(message: RawMessage, index: number): string {
  if (message.toolCallId) return `tool:${message.toolCallId}`;
  if (message.id) return `msg:${message.id}`;
  return `msg:${message.role}:${message.timestamp || 'na'}:${index}`;
}

function makeStreamMessage(text: string, ts: number): RawMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: ts / 1000,
  };
}

function isHistoryToolOnlyMessage(message: RawMessage): boolean {
  if (message.role === 'toolresult') return true;
  if (!Array.isArray(message.content)) return false;
  let hasTool = false;
  let hasText = false;
  for (const block of message.content) {
    const type = String(block.type || '').toLowerCase();
    if (type === 'tool_use' || type === 'toolcall' || type === 'tool_result' || type === 'toolresult') {
      hasTool = true;
      continue;
    }
    if (type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      hasText = true;
    }
  }
  return hasTool && !hasText;
}

function normalizeRoleForGrouping(message: RawMessage): string {
  const role = String(message.role || 'unknown').toLowerCase();
  if (role === 'user') return 'user';
  if (role === 'assistant') {
    if (message.toolCallId || message.toolName) return 'tool';
    if (Array.isArray(message.content)) {
      const hasToolResult = message.content.some((block) => {
        const type = String(block.type || '').toLowerCase();
        return type === 'toolresult' || type === 'tool_result';
      });
      if (hasToolResult) return 'tool';
    }
    return 'assistant';
  }
  if (role === 'toolresult' || role === 'tool_result' || role === 'tool') return 'tool';
  if (role === 'system') return 'system';
  return role;
}

function buildChatItems(params: {
  messages: RawMessage[];
  toolMessages: RawMessage[];
  streamSegments: StreamSegment[];
  streamingMessage: RawMessage | null;
  sessionKey: string;
  sending: boolean;
  pendingFinal: boolean;
}): Array<ChatItem | MessageGroup> {
  const shouldSuppressHistoryToolFragments = params.sending && params.toolMessages.length > 0;
  const items: ChatItem[] = params.messages.flatMap((message, index) => {
    if (shouldSuppressHistoryToolFragments && isHistoryToolOnlyMessage(message)) {
      return [];
    }
    return [{
      kind: 'message' as const,
      key: getMessageKey(message, index),
      message,
    }];
  });

  const maxLen = Math.max(params.streamSegments.length, params.toolMessages.length);
  for (let index = 0; index < maxLen; index += 1) {
    const segment = params.streamSegments[index];
    if (segment?.text?.trim()) {
      items.push({
        kind: 'stream',
        key: `stream-seg:${params.sessionKey}:${index}`,
        text: segment.text,
        startedAt: segment.ts,
      });
    }
    const toolMessage = params.toolMessages[index];
    if (toolMessage) {
      items.push({
        kind: 'message',
        key: `tool-stream:${params.sessionKey}:${toolMessage.toolCallId || index}`,
        message: toolMessage,
      });
    }
  }

  if (params.streamingMessage) {
    items.push({
      kind: 'stream',
      key: `stream:${params.sessionKey}:${params.streamingMessage.timestamp || 'live'}`,
      text: extractText(params.streamingMessage),
      startedAt: params.streamingMessage.timestamp ? params.streamingMessage.timestamp * 1000 : Date.now(),
    });
  } else if (params.sending && params.pendingFinal) {
    items.push({ kind: 'reading-indicator', key: `reading:${params.sessionKey}` });
  }

  const grouped: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;
  for (const item of items) {
    if (item.kind !== 'message') {
      if (currentGroup) {
        grouped.push(currentGroup);
        currentGroup = null;
      }
      grouped.push(item);
      continue;
    }
    const role = normalizeRoleForGrouping(item.message);
    const timestamp = item.message.timestamp ? item.message.timestamp * 1000 : Date.now();
    if (!currentGroup || currentGroup.role !== role) {
      if (currentGroup) grouped.push(currentGroup);
      currentGroup = {
        kind: 'group',
        key: `group:${role}:${item.key}`,
        role,
        messages: [{ key: item.key, message: item.message }],
        timestamp,
      };
    } else {
      currentGroup.messages.push({ key: item.key, message: item.message });
      currentGroup.timestamp = timestamp;
    }
  }
  if (currentGroup) grouped.push(currentGroup);
  return grouped;
}

function extractGroupMeta(group: MessageGroup, contextWindow: number | null): GroupMeta | null {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let model: string | null = null;
  let hasUsage = false;

  for (const { message } of group.messages) {
    const msg = message as unknown as Record<string, unknown>;
    if (msg.role !== 'assistant') continue;
    const usage = msg.usage as Record<string, number> | undefined;
    if (usage) {
      hasUsage = true;
      input += usage.input ?? usage.inputTokens ?? 0;
      output += usage.output ?? usage.outputTokens ?? 0;
      cacheRead += usage.cacheRead ?? usage.cache_read_input_tokens ?? 0;
      cacheWrite += usage.cacheWrite ?? usage.cache_creation_input_tokens ?? 0;
    }
    const messageCost = msg.cost as Record<string, number> | undefined;
    if (messageCost?.total) cost += messageCost.total;
    if (typeof msg.model === 'string' && msg.model !== 'gateway-injected') {
      model = msg.model;
    }
  }

  if (!hasUsage && !model) return null;

  const contextPercent =
    contextWindow && input > 0 ? Math.min(Math.round((input / contextWindow) * 100), 100) : null;

  return { input, output, cacheRead, cacheWrite, cost, model, contextPercent };
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function MessageMeta({ meta, labels }: { meta: GroupMeta | null; labels: ChatThreadLabels }) {
  if (!meta) return null;
  const parts: ReactElement[] = [];

  if (meta.input) parts.push(<span key="in" className="msg-meta__tokens">{labels.tokenInputPrefix}{fmtTokens(meta.input)}</span>);
  if (meta.output) parts.push(<span key="out" className="msg-meta__tokens">{labels.tokenOutputPrefix}{fmtTokens(meta.output)}</span>);
  if (meta.cacheRead) parts.push(<span key="cr" className="msg-meta__cache">{labels.cacheReadPrefix}{fmtTokens(meta.cacheRead)}</span>);
  if (meta.cacheWrite) parts.push(<span key="cw" className="msg-meta__cache">{labels.cacheWritePrefix}{fmtTokens(meta.cacheWrite)}</span>);
  if (meta.cost > 0) parts.push(<span key="cost" className="msg-meta__cost">${meta.cost.toFixed(4)}</span>);
  if (meta.contextPercent !== null) {
    const cls = meta.contextPercent >= 90 ? 'msg-meta__ctx msg-meta__ctx--danger' : meta.contextPercent >= 75 ? 'msg-meta__ctx msg-meta__ctx--warn' : 'msg-meta__ctx';
    parts.push(<span key="ctx" className={cls}>{meta.contextPercent}{labels.contextSuffix}</span>);
  }
  if (meta.model) {
    const shortModel = meta.model.includes('/') ? meta.model.split('/').pop()! : meta.model;
    parts.push(<span key="model" className="msg-meta__model">{shortModel}</span>);
  }

  if (parts.length === 0) return null;
  return <span className="msg-meta">{parts}</span>;
}

function formatChatTime(timestamp: number, locale: string): string {
  const prefers24h = locale.startsWith('zh') || locale.startsWith('ja');
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !prefers24h,
  });
}

function extractToolCards(message: RawMessage): ToolCard[] {
  const cards: ToolCard[] = [];
  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const type = String(block.type || '').toLowerCase();
      if ((type === 'toolcall' || type === 'tool_use') && block.name) {
        cards.push({
          kind: 'call',
          name: block.name,
          args: block.arguments ?? block.input,
        });
      }
    }
    for (const block of content) {
      const type = String(block.type || '').toLowerCase();
      if ((type === 'toolresult' || type === 'tool_result') && (block.name || message.toolName || message.toolCallId)) {
        const text = typeof block.text === 'string'
          ? block.text
          : Array.isArray(block.content)
            ? extractText({ role: 'toolresult', content: block.content })
            : typeof block.content === 'string'
              ? block.content
              : undefined;
        cards.push({
          kind: 'result',
          name: block.name || message.toolName || message.toolCallId || 'tool',
          text,
        });
      }
    }
  }
  if ((String(message.role).toLowerCase() === 'toolresult' || String(message.role).toLowerCase() === 'tool_result') && !cards.some((card) => card.kind === 'result')) {
    cards.push({
      kind: 'result',
      name: message.toolName || message.toolCallId || 'tool',
      text: extractText(message),
    });
  }
  return cards;
}

function formatArgs(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function defaultToolTitle(name: string): string {
  const cleaned = name.replace(/_/g, ' ').trim();
  if (!cleaned) return 'Tool';
  return cleaned
    .split(/\s+/)
    .map((part) => `${part.at(0)?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function lookupValueByPath(args: unknown, path: string): unknown {
  if (!args || typeof args !== 'object') return undefined;
  let current: unknown = args;
  for (const segment of path.split('.')) {
    if (!segment || !current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolvePathArg(args: unknown): string | undefined {
  for (const key of ['path', 'file_path', 'filePath']) {
    const value = lookupValueByPath(args, key);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function resolveReadDetail(args: unknown): string | undefined {
  const path = resolvePathArg(args);
  if (!path) return undefined;
  const offset = lookupValueByPath(args, 'offset');
  const limit = lookupValueByPath(args, 'limit');
  const offsetNum = typeof offset === 'number' && Number.isFinite(offset) ? Math.max(1, Math.floor(offset)) : undefined;
  const limitNum = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : undefined;
  if (offsetNum !== undefined && limitNum !== undefined) {
    const unit = limitNum === 1 ? 'line' : 'lines';
    return `${unit} ${offsetNum}-${offsetNum + limitNum - 1} from ${path}`;
  }
  if (offsetNum !== undefined) return `from line ${offsetNum} in ${path}`;
  if (limitNum !== undefined) return `first ${limitNum} ${limitNum === 1 ? 'line' : 'lines'} of ${path}`;
  return `from ${path}`;
}

function resolveWriteDetail(toolName: string, args: unknown): string | undefined {
  const path = resolvePathArg(args) ?? (typeof lookupValueByPath(args, 'url') === 'string' ? String(lookupValueByPath(args, 'url')).trim() : undefined);
  if (!path) return undefined;
  const destinationPrefix = toolName === 'edit' ? 'in' : 'to';
  const content = ['content', 'newText', 'new_string']
    .map((key) => lookupValueByPath(args, key))
    .find((value): value is string => typeof value === 'string' && value.length > 0);
  if (content) return `${destinationPrefix} ${path} (${content.length} chars)`;
  return `${destinationPrefix} ${path}`;
}

function resolveExecDetail(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const command = lookupValueByPath(args, 'command');
  const workdir = lookupValueByPath(args, 'workdir');
  if (typeof command !== 'string' || !command.trim()) return undefined;
  const firstLine = command.trim().split(/\r?\n/)[0] ?? '';
  if (typeof workdir === 'string' && workdir.trim()) {
    return `${firstLine} (in ${workdir.trim()})`;
  }
  return firstLine;
}

function resolveToolDisplay(name: string, args: unknown, labels: ChatThreadLabels): ToolDisplay {
  const normalized = name.trim().toLowerCase() || 'tool';
  if (normalized === 'process') {
    const sessionId = lookupValueByPath(args, 'sessionId');
    return {
      label: labels.process,
      detail: typeof sessionId === 'string' && sessionId.trim() ? `with session ${sessionId.trim()}` : undefined,
    };
  }
  if (normalized === 'read') {
    return { label: labels.read, detail: resolveReadDetail(args) };
  }
  if (normalized === 'write' || normalized === 'edit' || normalized === 'attach') {
    return { label: defaultToolTitle(normalized), detail: resolveWriteDetail(normalized, args) };
  }
  if (normalized === 'exec') {
    return { label: labels.exec, detail: resolveExecDetail(args) };
  }
  return { label: defaultToolTitle(normalized) };
}

function previewText(text: string): string {
  const lines = text.split('\n');
  const preview = lines.slice(0, 2).join('\n');
  return preview.length > 100 ? `${preview.slice(0, 100)}...` : (lines.length > 2 ? `${preview}...` : preview);
}

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
const INLINE_DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

let markdownHooksInstalled = false;

function installMarkdownHooks() {
  if (markdownHooksInstalled) return;
  markdownHooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof HTMLAnchorElement)) return;
    const href = node.getAttribute('href');
    if (!href) return;
    node.setAttribute('rel', 'noreferrer noopener');
    node.setAttribute('target', '_blank');
  });
}

const htmlEscapeRenderer = new marked.Renderer();
htmlEscapeRenderer.html = ({ text }) => escapeHtml(text);
htmlEscapeRenderer.image = ({ href, text }) => {
  const label = (text || 'image').trim() || 'image';
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
  return `<div class="code-block-wrapper">${header}${codeBlock}</div>`;
};

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

function toSanitizedMarkdownHtml(markdown: string): string {
  const input = markdown.trim();
  if (!input) return '';
  installMarkdownHooks();
  let rendered: string;
  try {
    rendered = marked.parse(input, {
      renderer: htmlEscapeRenderer,
      gfm: true,
      breaks: true,
    }) as string;
  } catch {
    rendered = renderEscapedPlainTextHtml(input);
  }
  return DOMPurify.sanitize(rendered, sanitizeOptions);
}

function detectJson(text: string): { parsed: unknown; pretty: string } | null {
  const trimmed = text.trim();
  if (trimmed.length > 20000) return null;
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      return { parsed, pretty: JSON.stringify(parsed, null, 2) };
    } catch {
      return null;
    }
  }
  return null;
}

function jsonSummaryLabel(parsed: unknown): string {
  if (Array.isArray(parsed)) return `Array (${parsed.length} items)`;
  if (parsed && typeof parsed === 'object') {
    const keys = Object.keys(parsed as Record<string, unknown>);
    return keys.length <= 4 ? `{ ${keys.join(', ')} }` : `Object (${keys.length} keys)`;
  }
  return 'JSON';
}

function MessageMarkdown({ text, labels }: { text: string; labels: ChatThreadLabels }) {
  const html = toSanitizedMarkdownHtml(text)
    .replaceAll('>Copy<', `>${labels.codeCopy}<`)
    .replaceAll('>Copied!<', `>${labels.codeCopied}<`);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const onClick = async (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('.code-block-copy') as HTMLButtonElement | null;
      if (!button) return;
      const code = button.getAttribute('data-code');
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        button.dataset.copied = 'true';
        window.setTimeout(() => {
          if (button.dataset.copied === 'true') {
            delete button.dataset.copied;
          }
        }, 1200);
      } catch {
        delete button.dataset.copied;
      }
    };
    node.addEventListener('click', onClick);
    return () => node.removeEventListener('click', onClick);
  }, []);

  return (
    <div
      ref={containerRef}
      className="chat-text"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      className="chat-copy-button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function ToolCards({ cards, labels }: { cards: ToolCard[]; labels: ChatThreadLabels }) {
  if (cards.length === 0) return null;
  const calls = cards.filter((card) => card.kind === 'call');
  const results = cards.filter((card) => card.kind === 'result');
  const totalTools = Math.max(calls.length, results.length) || cards.length;
  const toolNames = [...new Set(cards.map((card) => card.name))];
  const summaryLabel =
    toolNames.length <= 3
      ? toolNames.join(', ')
      : `${toolNames.slice(0, 2).join(', ')} +${toolNames.length - 2} more`;
  return (
    <details className="chat-tools-collapse">
      <summary className="chat-tools-summary">
        <span className="chat-tools-summary__icon"><Zap className="h-3.5 w-3.5" /></span>
        <span className="chat-tools-summary__count">{labels.toolCount(totalTools)}</span>
        <span className="chat-tools-summary__names">{summaryLabel}</span>
      </summary>
      <div className="chat-tools-collapse__body">
        <div className="chat-tool-stack">
          {cards.map((card, index) => {
            const hasText = Boolean(card.text?.trim());
            const inline = hasText && card.text!.length <= 80;
            const display = resolveToolDisplay(card.name, card.args, labels);
            return (
              <div className="chat-tool-card" key={`${card.kind}:${card.name}:${index}`}>
                <div className="chat-tool-card__header">
                  <div className="chat-tool-card__title">
                    <span className="chat-tool-card__icon">
                      {card.kind === 'call' ? <Zap className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span>{display.label}</span>
                  </div>
                  {card.kind === 'result' && <span className="chat-tool-card__action">{labels.view}</span>}
                </div>
                {card.kind === 'call' && display.detail ? (
                  <div className="chat-tool-card__detail">{display.detail}</div>
                ) : null}
                {card.kind === 'call' && !display.detail && card.args ? (
                  <div className="chat-tool-card__detail">{previewText(formatArgs(card.args))}</div>
                ) : null}
                {card.kind === 'result' && !hasText ? (
                  <div className="chat-tool-card__status-text muted">{labels.completed}</div>
                ) : null}
                {card.kind === 'result' && hasText && !inline ? (
                  <div className="chat-tool-card__preview mono">{previewText(card.text!)}</div>
                ) : null}
                {card.kind === 'result' && inline ? (
                  <div className="chat-tool-card__inline mono">{card.text}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function MessageImages({ message }: { message: RawMessage }) {
  const contentImages = extractImages(message).map((image) => {
    const block = image as { url?: string; data?: string; mimeType: string };
    const src = block.url
      ? block.url
      : block.data
        ? `data:${block.mimeType};base64,${block.data}`
        : '';
    return { src, alt: 'image' };
  }).filter((image) => image.src);
  const attachedImages = (message._attachedFiles || [])
    .filter((file) => file.mimeType.startsWith('image/') && file.preview)
    .map((file) => ({ src: file.preview!, alt: file.fileName }));
  const images = [...contentImages, ...attachedImages];
  if (images.length === 0) return null;
  return (
    <div className="chat-message-images">
      {images.map((image, index) => (
        <img
          key={`${image.src || 'img'}:${index}`}
          className="chat-message-image"
          src={image.src || ''}
          alt={image.alt || 'image'}
        />
      ))}
    </div>
  );
}

function GroupedMessage({ message, isStreaming, showThinking, labels }: { message: RawMessage; isStreaming?: boolean; showThinking: boolean; labels: ChatThreadLabels }) {
  const text = extractText(message);
  const thinking = showThinking && normalizeRoleForGrouping(message) === 'assistant' ? extractThinking(message) : null;
  const cards = extractToolCards(message);
  const isToolMessage = normalizeRoleForGrouping(message) === 'tool';
  const hasToolCards = cards.length > 0;
  const hasText = Boolean(text.trim());
  const jsonResult = hasText && !isStreaming ? detectJson(text) : null;
  const toolNames = [...new Set(cards.map((card) => card.name))];
  const toolSummaryLabel =
    toolNames.length <= 3
      ? toolNames.join(', ')
      : `${toolNames.slice(0, 2).join(', ')} +${toolNames.length - 2} more`;
  const toolPreview = hasText && !toolSummaryLabel ? text.trim().replace(/\s+/g, ' ').slice(0, 120) : '';

  if (!hasText && hasToolCards && isToolMessage) {
    return <ToolCards cards={cards} labels={labels} />;
  }

  return (
    <div className={cn('chat-bubble', isStreaming && 'streaming', 'fade-in')}>
      {normalizeRoleForGrouping(message) === 'assistant' && hasText ? <div className="chat-bubble-actions"><CopyButton text={text} /></div> : null}
      {isToolMessage ? (
        <details className="chat-tool-msg-collapse" open={isStreaming}>
          <summary className="chat-tool-msg-summary">
            <span className="chat-tool-msg-summary__icon"><Zap className="h-3.5 w-3.5" /></span>
            <span className="chat-tool-msg-summary__label">{labels.toolOutput}</span>
            {toolSummaryLabel ? <span className="chat-tool-msg-summary__names">{toolSummaryLabel}</span> : null}
            {!toolSummaryLabel && toolPreview ? <span className="chat-tool-msg-summary__preview">{toolPreview}</span> : null}
          </summary>
          <div className="chat-tool-msg-body">
            <MessageImages message={message} />
            {thinking ? (
              <details className="chat-reasoning-collapse">
                <summary className="chat-reasoning-summary">{labels.reasoning}</summary>
                <div className="chat-thinking"><MessageMarkdown text={thinking} labels={labels} /></div>
              </details>
            ) : null}
            {jsonResult ? (
              <details className="chat-json-collapse">
                <summary className="chat-json-summary">
                  <span className="chat-json-badge">{labels.json}</span>
                  <span className="chat-json-label">{jsonSummaryLabel(jsonResult.parsed)}</span>
                </summary>
                <pre className="chat-json-content"><code>{jsonResult.pretty}</code></pre>
              </details>
            ) : hasText ? <MessageMarkdown text={text} labels={labels} /> : null}
            <ToolCards cards={cards} labels={labels} />
          </div>
        </details>
      ) : (
        <>
          <MessageImages message={message} />
          {thinking ? (
            <details className="chat-reasoning-collapse" open={isStreaming}>
              <summary className="chat-reasoning-summary">{labels.reasoning}</summary>
              <div className="chat-thinking"><MessageMarkdown text={thinking} labels={labels} /></div>
            </details>
          ) : null}
          {jsonResult ? (
            <details className="chat-json-collapse">
              <summary className="chat-json-summary">
                <span className="chat-json-badge">{labels.json}</span>
                <span className="chat-json-label">{jsonSummaryLabel(jsonResult.parsed)}</span>
              </summary>
              <pre className="chat-json-content"><code>{jsonResult.pretty}</code></pre>
            </details>
          ) : hasText ? <MessageMarkdown text={text} labels={labels} /> : null}
          {hasToolCards ? <ToolCards cards={cards} labels={labels} /> : null}
        </>
      )}
    </div>
  );
}

function Avatar({ role }: { role: string }) {
  return (
    <div className="chat-avatar">
      {role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
    </div>
  );
}

function Group({ group, showThinking, labels, contextWindow, locale }: { group: MessageGroup; showThinking: boolean; labels: ChatThreadLabels; contextWindow: number | null; locale: string }) {
  const timestamp = formatChatTime(group.timestamp, locale);
  const label = group.role === 'user' ? labels.you : group.role === 'assistant' ? labels.assistant : labels.tool;
  const meta = extractGroupMeta(group, contextWindow);
  return (
    <div className={cn('chat-group', group.role)}>
      <Avatar role={group.role} />
      <div className="chat-group-messages">
        {group.messages.map((item) => (
          <GroupedMessage key={item.key} message={item.message} showThinking={showThinking} labels={labels} />
        ))}
        <div className="chat-group-footer">
          <span className="chat-sender-name">{label}</span>
          <span className="chat-group-timestamp">{timestamp}</span>
          <MessageMeta meta={meta} labels={labels} />
        </div>
      </div>
    </div>
  );
}

function StreamingGroup({ text, startedAt, labels, locale }: { text: string; startedAt: number; labels: ChatThreadLabels; locale: string }) {
  const timestamp = formatChatTime(startedAt, locale);
  return (
    <div className="chat-group assistant">
      <Avatar role="assistant" />
      <div className="chat-group-messages">
        <GroupedMessage message={makeStreamMessage(text, startedAt)} isStreaming showThinking={false} labels={labels} />
        <div className="chat-group-footer">
          <span className="chat-sender-name">{labels.assistant}</span>
          <span className="chat-group-timestamp">{timestamp}</span>
        </div>
      </div>
    </div>
  );
}

function ReadingIndicator() {
  return (
    <div className="chat-group assistant">
      <Avatar role="assistant" />
      <div className="chat-group-messages">
        <div className="chat-bubble chat-reading-indicator" aria-hidden="true">
          <span className="chat-reading-indicator__dots">
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    </div>
  );
}

export const ChatThread = memo(function ChatThread({
  messages,
  toolMessages,
  streamSegments,
  streamingMessage,
  sending,
  pendingFinal,
  showThinking,
  sessionKey,
  contextWindow,
  assistantName,
}: {
  messages: RawMessage[];
  toolMessages: RawMessage[];
  streamSegments: StreamSegment[];
  streamingMessage: RawMessage | null;
  sending: boolean;
  pendingFinal: boolean;
  showThinking: boolean;
  sessionKey: string;
  contextWindow?: number | null;
  assistantName?: string;
}) {
  const { t, i18n } = useTranslation('chat');
  const locale = i18n.language || 'en';
  const resolvedAssistantName = assistantName?.trim() || t('thread.assistant', 'Assistant');
  const labels: ChatThreadLabels = {
    codeCopy: t('thread.codeCopy', 'Copy'),
    codeCopied: t('thread.codeCopied', 'Copied!'),
    json: t('thread.json', 'JSON'),
    toolOutput: t('thread.toolOutput', 'Tool output'),
    reasoning: t('thread.reasoning', 'Reasoning'),
    you: t('thread.you', 'You'),
    assistant: resolvedAssistantName,
    tool: t('thread.tool', 'Tool'),
    tokenInputPrefix: t('thread.tokenInputPrefix', '↑'),
    tokenOutputPrefix: t('thread.tokenOutputPrefix', '↓'),
    cacheReadPrefix: t('thread.cacheReadPrefix', 'R'),
    cacheWritePrefix: t('thread.cacheWritePrefix', 'W'),
    contextSuffix: t('thread.contextSuffix', '% ctx'),
    completed: t('thread.completed', 'Completed'),
    view: t('thread.view', 'View'),
    toolCount: (count) => t('thread.toolCount', { count, defaultValue: `${count} tools` }),
    process: t('thread.process', 'Process'),
    read: t('thread.read', 'Read'),
    exec: t('thread.exec', 'Exec'),
  };
  const items = buildChatItems({
    messages,
    toolMessages,
    streamSegments,
    streamingMessage,
    sessionKey,
    sending,
    pendingFinal,
  });

  return (
    <div className="openclaw-chat-thread">
      {items.map((item) => {
        if (item.kind === 'group') {
          return <Group key={item.key} group={item} showThinking={showThinking} labels={labels} contextWindow={contextWindow ?? null} locale={locale} />;
        }
        if (item.kind === 'stream') {
          return <StreamingGroup key={item.key} text={item.text} startedAt={item.startedAt} labels={labels} locale={locale} />;
        }
        return <ReadingIndicator key={item.key} />;
      })}
    </div>
  );
});
