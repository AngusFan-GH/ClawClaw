import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { AlertCircle, Bot, Check, Copy, User, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { RawMessage, StreamSegment } from '@/stores/chat';
import { extractImages, extractText, extractThinking } from './message-utils';
import { toSanitizedMarkdownHtml } from './markdown';
import { detectTextDirection } from './text-direction';


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
  reasoning: string;
  you: string;
  assistant: string;
  tool: string;
  toolOutput: string;
  tokenInputPrefix: string;
  tokenOutputPrefix: string;
  cacheReadPrefix: string;
  cacheWritePrefix: string;
  contextSuffix: string;
  completed: string;
  view: string;
  collapse: string;
  toolCount: (count: number) => string;
  process: string;
  read: string;
  exec: string;
  historyWindowLimited: string;
  historyCompacted: string;
  loadingEarlier: string;
};

type ChatItem =
  | { kind: 'message'; key: string; message: RawMessage }
  | { kind: 'stream'; key: string; text: string; startedAt: number }
  | { kind: 'reading-indicator'; key: string };

type MessageGroup = {
  kind: 'group';
  key: string;
  role: string;
  senderLabel?: string | null;
  messages: Array<{ key: string; message: RawMessage }>;
  timestamp: number;
  isStreaming: boolean;
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

type NormalizedContentItem = {
  type: string;
  text?: string;
  name?: string;
  args?: unknown;
  arguments?: unknown;
};

type NormalizedMessage = {
  role: string;
  content: NormalizedContentItem[];
  timestamp: number;
  id?: string;
  senderLabel?: string | null;
};

function toDisplayTimestampMs(timestamp: number): number {
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

function getMessageKey(message: RawMessage): string {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : '';
  if (toolCallId) return `tool:${toolCallId}`;
  const id = typeof message.id === 'string' ? message.id : '';
  if (id) return `msg:${id}`;
  const timestamp = typeof message.timestamp === 'number' ? message.timestamp : null;
  const role = typeof message.role === 'string' ? message.role : 'unknown';
  if (timestamp != null) return `msg:${role}:${timestamp}`;
  return `msg:${role}`;
}

function makeStreamMessage(text: string, ts: number): RawMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: ts,
  };
}

function normalizeMessage(message: RawMessage): NormalizedMessage {
  const m = message as unknown as Record<string, unknown>;
  let role = typeof m.role === 'string' ? m.role : 'unknown';

  const hasToolId = typeof m.toolCallId === 'string' || typeof m.tool_call_id === 'string';
  const contentRaw = m.content;
  const contentItems = Array.isArray(contentRaw) ? contentRaw : null;
  const hasToolContent =
    Array.isArray(contentItems)
    && contentItems.some((item) => {
      const x = item as Record<string, unknown>;
      const t = (typeof x.type === 'string' ? x.type : '').toLowerCase();
      return t === 'toolresult' || t === 'tool_result';
    });
  const hasToolName = typeof m.toolName === 'string' || typeof m.tool_name === 'string';

  if (hasToolId || hasToolContent || hasToolName) {
    role = 'toolResult';
  }

  let content: NormalizedContentItem[] = [];
  if (typeof m.content === 'string') {
    content = [{ type: 'text', text: m.content }];
  } else if (Array.isArray(m.content)) {
    content = (m.content as Array<Record<string, unknown>>).map((item) => ({
      type: (item.type as string) || 'text',
      text: item.text as string | undefined,
      name: item.name as string | undefined,
      args: item.args,
      arguments: item.arguments,
    }));
  } else if (typeof m.text === 'string') {
    content = [{ type: 'text', text: m.text }];
  }

  return {
    role,
    content,
    timestamp: typeof m.timestamp === 'number' ? toDisplayTimestampMs(m.timestamp) : Date.now(),
    id: typeof m.id === 'string' ? m.id : undefined,
    senderLabel:
      typeof m.senderLabel === 'string' && m.senderLabel.trim() ? m.senderLabel.trim() : null,
  };
}

function normalizeRoleForGrouping(roleOrMessage: string | RawMessage): string {
  const role =
    typeof roleOrMessage === 'string'
      ? roleOrMessage
      : normalizeMessage(roleOrMessage).role;
  const lower = role.toLowerCase();
  if (role === 'user' || role === 'User') return 'user';
  if (role === 'assistant') return 'assistant';
  if (role === 'system') return 'system';
  if (lower === 'toolresult' || lower === 'tool_result' || lower === 'tool' || lower === 'function') {
    return 'tool';
  }
  return role;
}

function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    if (item.kind !== 'message') {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

    const normalized = normalizeMessage(item.message);
    const role = normalizeRoleForGrouping(normalized.role);
    const senderLabel = role.toLowerCase() === 'user' ? (normalized.senderLabel ?? null) : null;
    const timestamp = normalized.timestamp || Date.now();

    if (
      !currentGroup
      || currentGroup.role !== role
      || (role.toLowerCase() === 'user' && currentGroup.senderLabel !== senderLabel)
    ) {
      if (currentGroup) result.push(currentGroup);
      currentGroup = {
        kind: 'group',
        key: `group:${role}:${item.key}`,
        role,
        senderLabel,
        messages: [{ key: item.key, message: item.message }],
        timestamp,
        isStreaming: false,
      };
    } else {
      currentGroup.messages.push({ key: item.key, message: item.message });
    }
  }

  if (currentGroup) result.push(currentGroup);
  return result;
}

function buildChatItems(params: {
  messages: RawMessage[];
  toolMessages: RawMessage[];
  streamSegments: StreamSegment[];
  streamingMessage: RawMessage | null;
  streamingStartedAt: number;
  sessionKey: string;
  sending: boolean;
  pendingFinal: boolean;
  showThinking: boolean;
}): Array<ChatItem | MessageGroup> {
  const items: ChatItem[] = [];
  const history = Array.isArray(params.messages) ? params.messages : [];
  const tools = params.showThinking && Array.isArray(params.toolMessages) ? params.toolMessages : [];

  for (let i = 0; i < history.length; i += 1) {
    if (history[i].role === 'compactionSummary') {
      continue;
    }
    const normalizedRole = normalizeRoleForGrouping(history[i]);
    if (!params.showThinking && normalizedRole === 'tool') {
      continue;
    }
    items.push({
      kind: 'message',
      key: getMessageKey(history[i]),
      message: history[i],
    });
  }

  const maxLen = Math.max(params.streamSegments.length, tools.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i < params.streamSegments.length && params.streamSegments[i].text.trim().length > 0) {
      items.push({
        kind: 'stream',
        key: `stream-seg:${params.sessionKey}:${i}`,
        text: params.streamSegments[i].text,
        startedAt: params.streamSegments[i].ts,
      });
    }
    if (i < tools.length) {
      items.push({
        kind: 'message',
        key: getMessageKey(tools[i]),
        message: tools[i],
      });
    }
  }

  if (params.streamingMessage) {
    const text = extractText(params.streamingMessage);
    const key = `stream:${params.sessionKey}`;
    if (text.trim().length > 0) {
      items.push({
        kind: 'stream',
        key,
        text,
        startedAt: params.streamingStartedAt
          || (params.streamingMessage.timestamp
            ? toDisplayTimestampMs(params.streamingMessage.timestamp)
            : Date.now()),
      });
    } else {
      items.push({ kind: 'reading-indicator', key });
    }
  } else if (params.sending && params.pendingFinal) {
    items.push({ kind: 'reading-indicator', key: `reading:${params.sessionKey}` });
  }

  return groupMessages(items);
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

const MessageMeta = memo(function MessageMeta({ meta, labels }: { meta: GroupMeta | null; labels: ChatThreadLabels }) {
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
});

function formatChatTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
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

function formatReasoningMarkdown(text: string, labels: ChatThreadLabels): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `_${line}_`);
  return lines.length ? [`_${labels.reasoning}:_`, ...lines].join('\n') : '';
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

const MessageMarkdown = memo(function MessageMarkdown({ text, labels }: { text: string; labels: ChatThreadLabels }) {
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
          if (button.dataset.copied === 'true') delete button.dataset.copied;
        }, 1200);
      } catch {
        delete button.dataset.copied;
      }
    };
    node.addEventListener('click', onClick);
    return () => node.removeEventListener('click', onClick);
  }, []);

  return <div ref={containerRef} className="chat-text" dangerouslySetInnerHTML={{ __html: html }} />;
});

const CopyButton = memo(function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      className="chat-copy-button"
      onClick={async (e) => {
        e.stopPropagation();
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
});


function extractToolCards(message: RawMessage): ToolCard[] {
  const m = message as unknown as Record<string, unknown>;
  const content = Array.isArray(m.content) ? (m.content.filter(Boolean) as Array<Record<string, unknown>>) : [];
  const cards: ToolCard[] = [];

  for (const item of content) {
    const kind = (typeof item.type === 'string' ? item.type : '').toLowerCase();
    const isToolCall =
      ['toolcall', 'tool_call', 'tooluse', 'tool_use'].includes(kind)
      || (typeof item.name === 'string' && item.arguments != null);
    if (isToolCall) {
      let args: unknown = item.arguments ?? item.args;
      if (typeof args === 'string') {
        const trimmed = args.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            args = JSON.parse(trimmed);
          } catch {
            args = trimmed;
          }
        }
      }
      cards.push({
        kind: 'call',
        name: (item.name as string) ?? 'tool',
        args,
      });
    }
  }

  for (const item of content) {
    const kind = (typeof item.type === 'string' ? item.type : '').toLowerCase();
    if (kind !== 'toolresult' && kind !== 'tool_result') continue;
    const text =
      typeof item.text === 'string'
        ? item.text
        : typeof item.content === 'string'
          ? item.content
          : undefined;
    const name = typeof item.name === 'string' ? item.name : 'tool';
    cards.push({ kind: 'result', name, text });
  }

  const lowerRole = typeof m.role === 'string' ? m.role.toLowerCase() : '';
  if ((lowerRole === 'toolresult' || lowerRole === 'tool_result') && !cards.some((card) => card.kind === 'result')) {
    const name =
      (typeof m.toolName === 'string' && m.toolName)
      || (typeof m.tool_name === 'string' && m.tool_name)
      || 'tool';
    const text = extractText(message) || undefined;
    cards.push({ kind: 'result', name, text });
  }

  return cards;
}

const ToolCards = memo(function ToolCards({ cards, labels }: { cards: ToolCard[]; labels: ChatThreadLabels }) {
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
        {cards.map((card, index) => (
          <ToolCardItem key={`${card.kind}:${card.name}:${index}`} card={card} labels={labels} />
        ))}
      </div>
    </details>
  );
});

const ToolCardItem = memo(function ToolCardItem({
  card,
  labels,
}: {
  card: ToolCard;
  labels: ChatThreadLabels;
}) {
  const [expanded, setExpanded] = useState(false);
  const display = resolveToolDisplay(card.name, card.args, labels);
  const hasText = Boolean(card.text?.trim());
  const inline = hasText && (card.text?.length ?? 0) <= 80;

  return (
    <div className={cn('chat-tool-card', expanded && 'chat-tool-card--expanded')}>
      <div className="chat-tool-card__header">
        <div className="chat-tool-card__title">
          <span className="chat-tool-card__icon">
            {card.kind === 'call' ? <Zap className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          </span>
          <span>{display.label}</span>
        </div>
        {card.kind === 'result' && hasText ? (
          <button
            type="button"
            className="chat-tool-card__action"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? labels.collapse : labels.view}
          </button>
        ) : null}
        {card.kind === 'result' && !hasText ? <span className="chat-tool-card__status"><Check className="h-3.5 w-3.5" /></span> : null}
      </div>
      {display.detail ? <div className="chat-tool-card__detail">{display.detail}</div> : null}
      {card.kind === 'call' && !display.detail && card.args ? (
        <div className="chat-tool-card__detail">{previewText(formatArgs(card.args))}</div>
      ) : null}
      {card.kind === 'result' && !hasText ? (
        <div className="chat-tool-card__status-text muted">{labels.completed}</div>
      ) : null}
      {card.kind === 'result' && hasText && !inline ? (
        <>
          {!expanded ? (
            <div className="chat-tool-card__preview mono">{previewText(card.text!)}</div>
          ) : null}
          {expanded ? (
            <pre className="chat-tool-card__full mono"><code>{card.text}</code></pre>
          ) : null}
        </>
      ) : null}
      {card.kind === 'result' && inline ? (
        <div className="chat-tool-card__inline mono">{card.text}</div>
      ) : null}
    </div>
  );
});

const MessageImages = memo(function MessageImages({ message }: { message: RawMessage }) {
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
        <img key={`${image.src}:${index}`} className="chat-message-image" src={image.src} alt={image.alt || 'image'} />
      ))}
    </div>
  );
});

const GroupedMessage = memo(function GroupedMessage({
  message,
  isStreaming,
  showThinking,
  labels,
}: {
  message: RawMessage;
  isStreaming: boolean;
  showThinking: boolean;
  labels: ChatThreadLabels;
}) {
  const m = message as unknown as Record<string, unknown>;
  const role = typeof m.role === 'string' ? m.role : 'unknown';
  const normalizedRole = normalizeRoleForGrouping(role);
  const isToolResult =
    String(role).toLowerCase() === 'toolresult'
    || String(role).toLowerCase() === 'tool_result'
    || typeof m.toolCallId === 'string'
    || typeof m.tool_call_id === 'string';

  const toolCards = extractToolCards(message);
  const hasToolCards = toolCards.length > 0;
  const images = extractImages(message);
  const hasImages = images.length > 0;
  const markdown = extractText(message)?.trim() ? extractText(message) : '';
  const extractedThinking = showThinking && role === 'assistant' ? extractThinking(message) : null;
  const reasoningMarkdown = extractedThinking ? formatReasoningMarkdown(extractedThinking, labels) : null;
  const canCopyMarkdown = role === 'assistant' && Boolean(markdown.trim());
  const jsonResult = markdown && !isStreaming ? detectJson(markdown) : null;
  const visibleToolCards = showThinking && hasToolCards;

  if (!showThinking && (normalizedRole === 'tool' || isToolResult) && !markdown.trim()) {
    return null;
  }

  if (!markdown && visibleToolCards && isToolResult) {
    return <ToolCards cards={toolCards} labels={labels} />;
  }
  if (!markdown && !visibleToolCards && !hasImages) {
    return null;
  }

  const isToolMessage = showThinking && (normalizedRole === 'tool' || isToolResult);
  const toolNames = [...new Set(toolCards.map((card) => card.name))];
  const toolSummaryLabel =
    toolNames.length <= 3
      ? toolNames.join(', ')
      : `${toolNames.slice(0, 2).join(', ')} +${toolNames.length - 2} more`;
  const toolPreview = markdown && !toolSummaryLabel ? markdown.trim().replace(/\s+/g, ' ').slice(0, 120) : '';

  return (
    <div className={cn('chat-bubble', 'fade-in', isStreaming && 'streaming', canCopyMarkdown && 'has-copy')}>
      {canCopyMarkdown ? (
        <div className="chat-bubble-actions">
          <CopyButton text={markdown!} />
        </div>
      ) : null}
      {isToolMessage ? (
        <details className="chat-tool-msg-collapse">
          <summary className="chat-tool-msg-summary">
            <span className="chat-tool-msg-summary__icon"><Zap className="h-3.5 w-3.5" /></span>
            <span className="chat-tool-msg-summary__label">{labels.toolOutput}</span>
            {toolSummaryLabel ? <span className="chat-tool-msg-summary__names">{toolSummaryLabel}</span> : null}
            {!toolSummaryLabel && toolPreview ? <span className="chat-tool-msg-summary__preview">{toolPreview}</span> : null}
          </summary>
          <div className="chat-tool-msg-body">
            <MessageImages message={message} />
            {reasoningMarkdown ? <div className="chat-thinking"><MessageMarkdown text={reasoningMarkdown} labels={labels} /></div> : null}
            {jsonResult ? (
              <details className="chat-json-collapse">
                <summary className="chat-json-summary">
                  <span className="chat-json-badge">{labels.json}</span>
                  <span className="chat-json-label">{jsonSummaryLabel(jsonResult.parsed)}</span>
                </summary>
                <pre className="chat-json-content"><code>{jsonResult.pretty}</code></pre>
              </details>
            ) : markdown ? <div dir={detectTextDirection(markdown)}><MessageMarkdown text={markdown} labels={labels} /></div> : null}
            {hasToolCards ? <ToolCards cards={toolCards} labels={labels} /> : null}
          </div>
        </details>
      ) : (
        <>
          <MessageImages message={message} />
          {reasoningMarkdown ? <div className="chat-thinking"><MessageMarkdown text={reasoningMarkdown} labels={labels} /></div> : null}
          {jsonResult ? (
            <details className="chat-json-collapse">
              <summary className="chat-json-summary">
                <span className="chat-json-badge">{labels.json}</span>
                <span className="chat-json-label">{jsonSummaryLabel(jsonResult.parsed)}</span>
              </summary>
              <pre className="chat-json-content"><code>{jsonResult.pretty}</code></pre>
            </details>
          ) : markdown ? <div dir={detectTextDirection(markdown)}><MessageMarkdown text={markdown} labels={labels} /></div> : null}
          {hasToolCards ? <ToolCards cards={toolCards} labels={labels} /> : null}
        </>
      )}
    </div>
  );
});

const Avatar = memo(function Avatar({ role }: { role: string }) {
  const normalizedRole = normalizeRoleForGrouping(role);
  if (normalizedRole === 'user') {
    return (
      <div className="chat-avatar user">
        <User className="h-4 w-4" />
      </div>
    );
  }
  if (normalizedRole === 'tool') {
    return (
      <div className="chat-avatar tool">
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53a7.76 7.76 0 0 0 .07-1 7.76 7.76 0 0 0-.07-.97l2.11-1.63a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.15 7.15 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65a7.15 7.15 0 0 0-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64L4.57 11a7.9 7.9 0 0 0 0 1.94l-2.11 1.69a.49.49 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.72 1.69.98l.38 2.65c.05.24.26.42.49.42h4c.23 0 .44-.18.49-.42l.38-2.65a7.15 7.15 0 0 0 1.69-.98l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.49.49 0 0 0-.12-.64z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="chat-avatar assistant">
      <Bot className="h-4 w-4" />
    </div>
  );
});

const Group = memo(function Group({
  group,
  showThinking,
  labels,
  contextWindow,
  locale,
}: {
  group: MessageGroup;
  showThinking: boolean;
  labels: ChatThreadLabels;
  contextWindow: number | null;
  locale: string;
}) {
  const timestamp = formatChatTime(group.timestamp, locale);
  const label = group.role === 'user'
    ? (group.senderLabel?.trim() || labels.you)
    : group.role === 'assistant'
      ? labels.assistant
      : labels.tool;
  const meta = extractGroupMeta(group, contextWindow);

  return (
    <div className={cn('chat-group', group.role)}>
      <Avatar role={group.role} />
      <div className="chat-group-messages">
        {group.messages.map((item, index) => (
          <GroupedMessage
            key={item.key}
            message={item.message}
            isStreaming={group.isStreaming && index === group.messages.length - 1}
            showThinking={showThinking}
            labels={labels}
          />
        ))}
        <div className="chat-group-footer">
          <span className="chat-sender-name">{label}</span>
          <span className="chat-group-timestamp">{timestamp}</span>
          <MessageMeta meta={meta} labels={labels} />
        </div>
      </div>
    </div>
  );
});

const StreamingGroup = memo(function StreamingGroup({
  text,
  startedAt,
  labels,
  locale,
}: {
  text: string;
  startedAt: number;
  labels: ChatThreadLabels;
  locale: string;
}) {
  const timestamp = formatChatTime(startedAt, locale);
  return (
    <div className="chat-group assistant">
      <Avatar role="assistant" />
      <div className="chat-group-messages">
        <GroupedMessage
          message={makeStreamMessage(text, startedAt)}
          isStreaming
          showThinking={false}
          labels={labels}
        />
        <div className="chat-group-footer">
          <span className="chat-sender-name">{labels.assistant}</span>
          <span className="chat-group-timestamp">{timestamp}</span>
        </div>
      </div>
    </div>
  );
});

const ReadingIndicator = memo(function ReadingIndicator() {
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
});

export const ChatThread = memo(function ChatThread({
  messages,
  toolMessages,
  streamSegments,
  streamingMessage,
  sending,
  pendingFinal,
  showThinking,
  sessionKey,
  streamingStartedAt,
  contextWindow,
  assistantName,
  historyWindowLimited,
  canLoadEarlier,
  loadingEarlierHistory,
}: {
  messages: RawMessage[];
  toolMessages: RawMessage[];
  streamSegments: StreamSegment[];
  streamingMessage: RawMessage | null;
  sending: boolean;
  pendingFinal: boolean;
  showThinking: boolean;
  sessionKey: string;
  streamingStartedAt: number;
  contextWindow?: number | null;
  assistantName?: string;
  historyWindowLimited?: boolean;
  canLoadEarlier?: boolean;
  loadingEarlierHistory?: boolean;
}) {
  const { t, i18n } = useTranslation('chat');
  const locale = i18n.language || 'en';
  const resolvedAssistantName = assistantName?.trim() || t('thread.assistant', 'Assistant');

  const labels: ChatThreadLabels = useMemo(() => ({
    codeCopy: t('thread.codeCopy', 'Copy'),
    codeCopied: t('thread.codeCopied', 'Copied!'),
    json: t('thread.json', 'JSON'),
    reasoning: t('thread.reasoning', 'Reasoning'),
    you: t('thread.you', 'You'),
    assistant: resolvedAssistantName,
    tool: t('thread.tool', 'Tool'),
    toolOutput: t('thread.toolOutput', 'Tool output'),
    tokenInputPrefix: t('thread.tokenInputPrefix', '↑'),
    tokenOutputPrefix: t('thread.tokenOutputPrefix', '↓'),
    cacheReadPrefix: t('thread.cacheReadPrefix', 'R'),
    cacheWritePrefix: t('thread.cacheWritePrefix', 'W'),
    contextSuffix: t('thread.contextSuffix', '% ctx'),
    completed: t('thread.completed', 'Completed'),
    view: t('thread.view', 'View'),
    collapse: t('common:actions.collapse', 'Collapse'),
    toolCount: (count) => t('thread.toolCount', { count, defaultValue: `${count} tools` }),
    process: t('thread.process', 'Process'),
    read: t('thread.read', 'Read'),
    exec: t('thread.exec', 'Exec'),
    historyWindowLimited: t('thread.historyWindowLimited', 'Only the latest portion of this conversation is loaded. Earlier messages may be hidden.'),
    historyCompacted: t('thread.historyCompacted', 'Earlier parts of this conversation were compacted by OpenClaw to save context window space.'),
    loadingEarlier: t('thread.loadingEarlier', 'Loading earlier messages…'),
  }), [resolvedAssistantName, t]);

  const hasCompactionSummary = useMemo(
    () => messages.some((message) => message.role === 'compactionSummary'),
    [messages]
  );

  const items = useMemo(() => buildChatItems({
    messages,
    toolMessages,
    streamSegments,
    streamingMessage,
    streamingStartedAt,
    sessionKey,
    sending,
    pendingFinal,
    showThinking,
  }), [messages, toolMessages, streamSegments, streamingMessage, streamingStartedAt, sessionKey, sending, pendingFinal, showThinking]);

  // Context usage notice (>= 85% threshold)
  const contextNotice = useMemo<{ pct: number; used: number; limit: number } | null>(() => {
    if (!contextWindow) return null;
    let used = 0;
    // Find last assistant message with usage
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') {
        const u = msg.usage as Record<string, number> | undefined;
        if (u) {
          used = u.input ?? u.inputTokens ?? 0;
          break;
        }
      }
    }
    if (!used) return null;
    const ratio = used / contextWindow;
    if (ratio < 0.85) return null;
    const pct = Math.min(Math.round(ratio * 100), 100);
    return { pct, used, limit: contextWindow };
  }, [messages, contextWindow]);

  return (
    <div className="openclaw-chat-thread">
      {contextNotice ? (
        <div className="context-notice">
          <svg className="context-notice__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{contextNotice.pct}% context used</span>
          <span className="context-notice__detail">
            {contextNotice.used.toLocaleString()} / {contextNotice.limit.toLocaleString()}
          </span>
        </div>
      ) : null}
      {historyWindowLimited ? (
        <div className="context-notice">
          <AlertCircle className="context-notice__icon" />
          <span>{loadingEarlierHistory ? labels.loadingEarlier : labels.historyWindowLimited}</span>
          {canLoadEarlier && !loadingEarlierHistory ? (
            <span className="context-notice__detail">↑</span>
          ) : null}
        </div>
      ) : null}
      {hasCompactionSummary ? (
        <div className="context-notice">
          <AlertCircle className="context-notice__icon" />
          <span>{labels.historyCompacted}</span>
        </div>
      ) : null}
      {items.map((item) => {
        if (item.kind === 'group') {
          return (
            <Group
              key={item.key}
              group={item}
              showThinking={showThinking}
              labels={labels}
              contextWindow={contextWindow ?? null}
              locale={locale}
            />
          );
        }
        if (item.kind === 'stream') {
          return (
            <StreamingGroup
              key={item.key}
              text={item.text}
              startedAt={item.startedAt}
              labels={labels}
              locale={locale}
            />
          );
        }
        return <ReadingIndicator key={item.key} />;
      })}
    </div>
  );
});
