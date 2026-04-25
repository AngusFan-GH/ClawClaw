import { getHostApiBase } from '@/lib/host-api';
import type { RawMessage, StreamSegment } from '@/stores/chat';
import { extractImages, extractText, extractThinking } from './message-utils';
import { historyContainsPendingUserMessage } from './pending-user-message';

export type ToolCard = {
  kind: 'call' | 'result';
  name: string;
  args?: unknown;
  text?: string;
};

export type ToolDisplay = {
  label: string;
  detail?: string;
};

export type ChatThreadLabels = {
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
  btw: string;
  btwEphemeral: string;
  dismiss: string;
  delete: string;
  searchPlaceholder: string;
  noResults: string;
  deletedHidden: string;
  restore: string;
};

export type ChatItem =
  | { kind: 'message'; key: string; message: RawMessage }
  | { kind: 'divider'; key: string; label: string; timestamp: number }
  | { kind: 'stream'; key: string; text: string; startedAt: number }
  | { kind: 'reading-indicator'; key: string };

export type MessageGroup = {
  kind: 'group';
  key: string;
  role: string;
  senderLabel?: string | null;
  messages: Array<{ key: string; message: RawMessage }>;
  timestamp: number;
  isStreaming: boolean;
  hasReadingIndicator?: boolean;
};

export type TranscriptEntry =
  | { kind: 'notice'; key: string; tone?: 'default' | 'warning'; icon?: 'alert'; message: string; detail?: string }
  | { kind: 'side-result'; key: string; message: RawMessage }
  | { kind: 'divider'; key: string; label: string; timestamp: number }
  | MessageGroup
  | Extract<ChatItem, { kind: 'stream' | 'reading-indicator' }>;

type TranscriptFlowItem = Exclude<ChatItem, { kind: 'message' }> | MessageGroup;

export type GroupMeta = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  model: string | null;
  contextPercent: number | null;
};

export type NormalizedContentItem = {
  type: string;
  text?: string;
  name?: string;
  args?: unknown;
  arguments?: unknown;
  attachment?: {
    url: string;
    kind: 'image' | 'audio' | 'video' | 'document';
    label: string;
    mimeType?: string;
    isVoiceNote?: boolean;
  };
  preview?: {
    kind?: string;
    url?: string;
    viewId?: string;
    title?: string;
  };
  rawText?: string | null;
};

type NormalizedMessage = {
  role: string;
  content: NormalizedContentItem[];
  timestamp: number;
  id?: string;
  senderLabel?: string | null;
};

export function toDisplayTimestampMs(timestamp: number): number {
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

export function getMessageKey(message: RawMessage): string {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : '';
  if (toolCallId) return `tool:${toolCallId}`;
  const id = typeof message.id === 'string' ? message.id : '';
  if (id) return `msg:${id}`;
  const timestamp = typeof message.timestamp === 'number' ? message.timestamp : null;
  const role = typeof message.role === 'string' ? message.role : 'unknown';
  if (timestamp != null) return `msg:${role}:${timestamp}`;
  return `msg:${role}`;
}

export function makeStreamMessage(text: string, ts: number): RawMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: ts,
  };
}

export function normalizeMessage(message: RawMessage): NormalizedMessage {
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
    content = (m.content as Array<Record<string, unknown>>).flatMap((item): NormalizedContentItem[] => {
      if (
        item.type === 'attachment'
        && item.attachment
        && typeof item.attachment === 'object'
        && !Array.isArray(item.attachment)
      ) {
        const attachment = item.attachment as Record<string, unknown>;
        const url = typeof attachment.url === 'string' ? attachment.url.trim() : '';
        const label = typeof attachment.label === 'string' ? attachment.label.trim() : '';
        const kind = attachment.kind;
        if (
          url
          && label
          && (kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'document')
        ) {
          return [{
            type: 'attachment',
            attachment: {
              url,
              kind,
              label,
              mimeType: typeof attachment.mimeType === 'string' ? attachment.mimeType : undefined,
              isVoiceNote: attachment.isVoiceNote === true,
            },
          }];
        }
        return [];
      }
      if (
        item.type === 'canvas'
        && item.preview
        && typeof item.preview === 'object'
        && !Array.isArray(item.preview)
      ) {
        const preview = item.preview as Record<string, unknown>;
        return [{
          type: 'canvas',
          preview: {
            kind: typeof preview.kind === 'string' ? preview.kind : undefined,
            url: typeof preview.url === 'string' ? preview.url : undefined,
            viewId: typeof preview.viewId === 'string' ? preview.viewId : undefined,
            title: typeof preview.title === 'string' ? preview.title : undefined,
          },
          rawText: typeof item.rawText === 'string' ? item.rawText : null,
        }];
      }
      return [{
        type: (item.type as string) || 'text',
        text: item.text as string | undefined,
        name: item.name as string | undefined,
        args: item.args,
        arguments: item.arguments,
      }];
    });
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

export function buildAssistantAttachmentUrl(source: string): string {
  const url = new URL('/api/chat/assistant-media', getHostApiBase());
  url.searchParams.set('source', source);
  return url.toString();
}

export function normalizeRoleForGrouping(roleOrMessage: string | RawMessage): string {
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
      if (item.kind === 'reading-indicator' && currentGroup?.role === 'assistant') {
        currentGroup.hasReadingIndicator = true;
        continue;
      }
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

function isSameCalendarDay(left: number, right: number): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

function formatDividerLabel(timestamp: number, locale: string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  });
}

function withDateDividers(items: TranscriptFlowItem[], locale: string): TranscriptFlowItem[] {
  const result: TranscriptFlowItem[] = [];
  let lastTimestamp: number | null = null;

  for (const item of items) {
    const timestamp =
      item.kind === 'group'
        ? item.timestamp
        : item.kind === 'stream'
          ? item.startedAt
          : item.kind === 'divider'
              ? item.timestamp
              : null;

    if (timestamp != null && (!lastTimestamp || !isSameCalendarDay(lastTimestamp, timestamp))) {
      result.push({
        kind: 'divider',
        key: `divider:${new Date(timestamp).toDateString()}`,
        label: formatDividerLabel(timestamp, locale),
        timestamp,
      });
      lastTimestamp = timestamp;
    } else if (timestamp != null) {
      lastTimestamp = timestamp;
    }

    result.push(item);
  }

  return result;
}

function toGroupedFlowItems(items: ChatItem[]): TranscriptFlowItem[] {
  return groupMessages(items) as TranscriptFlowItem[];
}

function mergeTrailingReadingIndicatorIntoAssistantGroup(
  transcriptFlow: TranscriptFlowItem[],
  liveFlow: TranscriptFlowItem[],
): TranscriptFlowItem[] {
  if (liveFlow.length !== 1 || liveFlow[0]?.kind !== 'reading-indicator') {
    return [...transcriptFlow, ...liveFlow];
  }
  const lastTranscriptItem = transcriptFlow.at(-1);
  if (!lastTranscriptItem || lastTranscriptItem.kind !== 'group' || lastTranscriptItem.role !== 'assistant') {
    return [...transcriptFlow, ...liveFlow];
  }

  return [
    ...transcriptFlow.slice(0, -1),
    {
      ...lastTranscriptItem,
      hasReadingIndicator: true,
    },
  ];
}

export function buildChatItems(params: {
  messages: RawMessage[];
  pendingUserMessage: RawMessage | null;
  pendingAssistantMessage: RawMessage | null;
  toolMessages: RawMessage[];
  streamSegments: StreamSegment[];
  streamingMessage: RawMessage | null;
  streamingStartedAt: number;
  sessionKey: string;
  sending: boolean;
  pendingFinal: boolean;
  showThinking: boolean;
  locale: string;
}): TranscriptFlowItem[] {
  const transcriptItems: ChatItem[] = [];
  const liveItems: ChatItem[] = [];
  const history = Array.isArray(params.messages) ? params.messages : [];

  for (let i = 0; i < history.length; i += 1) {
    if (history[i].role === 'compactionSummary') {
      continue;
    }
    const normalizedRole = normalizeRoleForGrouping(history[i]);
    if (!params.showThinking && normalizedRole === 'tool') {
      continue;
    }
    transcriptItems.push({
      kind: 'message',
      key: getMessageKey(history[i]),
      message: history[i],
    });
  }

  if (params.pendingUserMessage && !historyContainsPendingUserMessage(history, params.pendingUserMessage)) {
    liveItems.push({
      kind: 'message',
      key: `pending:${params.pendingUserMessage.id ?? params.sessionKey}`,
      message: params.pendingUserMessage,
    });
  }

  if (params.pendingAssistantMessage && hasVisibleMessageContent(params.pendingAssistantMessage, params.showThinking)) {
    liveItems.push({
      kind: 'message',
      key: `pending-assistant:${params.pendingAssistantMessage.id ?? params.sessionKey}`,
      message: params.pendingAssistantMessage,
    });
  }

  for (const segment of params.streamSegments) {
    const text = segment.text.trim();
    if (!text) continue;
    liveItems.push({
      kind: 'stream',
      key: `stream-segment:${segment.ts}:${text.length}`,
      text,
      startedAt: segment.ts,
    });
  }

  if (params.showThinking) {
    for (const message of params.toolMessages) {
      if (!hasVisibleMessageContent(message, params.showThinking)) continue;
      liveItems.push({
        kind: 'message',
        key: `tool-live:${getMessageKey(message)}`,
        message,
      });
    }
  }

  const streamingText = params.streamingMessage ? extractText(params.streamingMessage).trim() : '';
  const streamingHasToolOrMedia =
    params.streamingMessage
    && params.showThinking
    && hasVisibleMessageContent(params.streamingMessage, params.showThinking);
  if (streamingText) {
    liveItems.push({
      kind: 'stream',
      key: `stream-live:${params.streamingStartedAt}:${streamingText.length}`,
      text: streamingText,
      startedAt: params.streamingStartedAt,
    });
  } else if (streamingHasToolOrMedia) {
    liveItems.push({
      kind: 'message',
      key: `stream-live-message:${getMessageKey(params.streamingMessage!)}`,
      message: params.streamingMessage!,
    });
  }

  const hasLiveAssistantContent = liveItems.some((item) => (
    item.kind === 'stream'
    || (item.kind === 'message' && normalizeRoleForGrouping(item.message) !== 'user')
  ));
  if ((params.sending || params.pendingFinal) && !hasLiveAssistantContent) {
    liveItems.push({ kind: 'reading-indicator', key: `reading:${params.sessionKey}` });
  }

  const transcriptFlow = withDateDividers(toGroupedFlowItems(transcriptItems), params.locale);
  const liveFlow = toGroupedFlowItems(liveItems);
  return mergeTrailingReadingIndicatorIntoAssistantGroup(transcriptFlow, liveFlow);
}

export function extractGroupMeta(group: MessageGroup, contextWindow: number | null): GroupMeta | null {
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

export function extractGroupSearchText(group: MessageGroup): string {
  return group.messages
    .map(({ message }) => extractText(message)?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

export function formatChatTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatArgs(value: unknown): string {
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

export function resolveToolDisplay(name: string, args: unknown, labels: ChatThreadLabels): ToolDisplay {
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

export function previewText(text: string): string {
  const lines = text.split('\n');
  const preview = lines.slice(0, 2).join('\n');
  return preview.length > 100 ? `${preview.slice(0, 100)}...` : (lines.length > 2 ? `${preview}...` : preview);
}

export function formatReasoningMarkdown(text: string, labels: ChatThreadLabels): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `_${line}_`);
  return lines.length ? [`_${labels.reasoning}:_`, ...lines].join('\n') : '';
}

export function detectJson(text: string): { parsed: unknown; pretty: string } | null {
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

export function jsonSummaryLabel(parsed: unknown): string {
  if (Array.isArray(parsed)) return `Array (${parsed.length} items)`;
  if (parsed && typeof parsed === 'object') {
    const keys = Object.keys(parsed as Record<string, unknown>);
    return keys.length <= 4 ? `{ ${keys.join(', ')} }` : `Object (${keys.length} keys)`;
  }
  return 'JSON';
}

export function extractToolCards(message: RawMessage): ToolCard[] {
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

export function hasVisibleMessageContent(message: RawMessage, showThinking: boolean): boolean {
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
  const hasImages = extractImages(message).length > 0;
  const markdown = extractText(message)?.trim() ? extractText(message) : '';
  const visibleToolCards = showThinking && hasToolCards;

  if (!showThinking && (normalizedRole === 'tool' || isToolResult) && !markdown.trim()) {
    return false;
  }
  if (!markdown && visibleToolCards && isToolResult) {
    return true;
  }
  if (!markdown && !visibleToolCards && !hasImages) {
    return false;
  }
  return true;
}

export function hasNonToolMarkdown(message: RawMessage): boolean {
  return Boolean(extractText(message)?.trim());
}

export function getReasoningMarkdown(message: RawMessage, showThinking: boolean, labels: ChatThreadLabels): string | null {
  const extractedThinking = showThinking && message.role === 'assistant' ? extractThinking(message) : null;
  return extractedThinking ? formatReasoningMarkdown(extractedThinking, labels) : null;
}
