import { getHostApiBase } from '@/lib/host-api';
import { normalizeChatTimestampForKey, normalizeChatTimestampMs } from '@/lib/chat-timestamps';
import type { RawMessage, StreamSegment } from '@/stores/chat';
import { extractImages, extractText, extractThinking } from './message-utils';
import { historyContainsPendingUserMessage } from './pending-user-message';

export type ToolCard = {
  kind?: 'call' | 'result';
  id: string;
  name: string;
  args?: unknown;
  inputText?: string;
  outputText?: string;
  text?: string;
  preview?: {
    kind: 'canvas';
    surface?: 'assistant_message';
    render?: 'url';
    url?: string;
    viewId?: string;
    title?: string;
    preferredHeight?: number;
    className?: string;
    style?: string;
  };
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
    surface?: string;
    render?: string;
    url?: string;
    viewId?: string;
    title?: string;
    preferredHeight?: number;
    className?: string;
    style?: string;
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

export function toDisplayTimestampMs(timestamp: unknown): number {
  return normalizeChatTimestampMs(timestamp) ?? Date.now();
}

export function getMessageKey(message: RawMessage): string {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : '';
  if (toolCallId) return `tool:${toolCallId}`;
  const id = typeof message.id === 'string' ? message.id : '';
  if (id) return `msg:${id}`;
  const timestamp = normalizeChatTimestampForKey(message.timestamp);
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

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
};

function getFileExtension(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  const source = (() => {
    try {
      if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed).pathname;
    } catch {
      // Fall back to the raw path.
    }
    return trimmed;
  })();
  return source.split(/[\\/]/).pop()?.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
}

function mediaKindFromMime(mimeType?: string): 'image' | 'audio' | 'video' | 'document' {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType?.startsWith('video/')) return 'video';
  return 'document';
}

function inferAttachment(url: string): NonNullable<NormalizedContentItem['attachment']> {
  const mimeType = MIME_BY_EXT[getFileExtension(url) ?? ''];
  const label = (() => {
    try {
      if (/^https?:\/\//i.test(url)) {
        const parsed = new URL(url);
        return parsed.pathname.split('/').pop()?.trim() || parsed.hostname || url;
      }
    } catch {
      // Fall back to path parsing.
    }
    return url.split(/[\\/]/).pop()?.trim() || url;
  })();
  return {
    url,
    kind: mediaKindFromMime(mimeType),
    label,
    mimeType,
  };
}

function isRenderableAssistantAttachment(url: string): boolean {
  const trimmed = url.trim();
  return (
    /^https?:\/\//i.test(trimmed)
    || /^data:(?:image|audio|video)\//i.test(trimmed)
    || /^\/(?:__openclaw__|media)\//.test(trimmed)
    || trimmed.startsWith('file://')
    || trimmed.startsWith('~')
    || trimmed.startsWith('/')
    || /^[a-zA-Z]:[\\/]/.test(trimmed)
  );
}

function shouldPreserveRelativeAssistantAttachment(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  return (
    !/^https?:\/\//i.test(trimmed)
    && !/^data:(?:image|audio|video)\//i.test(trimmed)
    && !/^\/(?:__openclaw__|media)\//.test(trimmed)
    && !trimmed.startsWith('file://')
    && !trimmed.startsWith('~')
    && !trimmed.startsWith('/')
    && !/^[a-zA-Z]:[\\/]/.test(trimmed)
  );
}

function parseMediaSegments(text: string): { text: string; attachments: NonNullable<NormalizedContentItem['attachment']>[] } {
  const attachments: NonNullable<NormalizedContentItem['attachment']>[] = [];
  const cleaned = text
    .replace(/MEDIA:([^\s]+)/g, (_match, rawUrl: string) => {
      const url = rawUrl.trim();
      if (url && isRenderableAssistantAttachment(url)) attachments.push(inferAttachment(url));
      if (url && shouldPreserveRelativeAssistantAttachment(url)) return `MEDIA:${url}`;
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: cleaned, attachments };
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function nestedRecord(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function recordString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function recordNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeCanvasHeight(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 160
    ? Math.min(Math.trunc(value), 1200)
    : undefined;
}

function coerceCanvasPreview(record: Record<string, unknown> | undefined): ToolCard['preview'] | undefined {
  if (!record) return undefined;
  const kind = recordString(record, 'kind')?.toLowerCase();
  if (kind !== 'canvas') return undefined;
  const presentation = nestedRecord(record, 'presentation');
  const view = nestedRecord(record, 'view');
  const source = nestedRecord(record, 'source');
  const target = recordString(presentation, 'target') ?? recordString(record, 'target');
  if (target && target !== 'assistant_message') return undefined;
  const title = recordString(presentation, 'title') ?? recordString(view, 'title') ?? recordString(record, 'title');
  const preferredHeight = normalizeCanvasHeight(
    recordNumber(presentation, 'preferred_height')
    ?? recordNumber(presentation, 'preferredHeight')
    ?? recordNumber(view, 'preferred_height')
    ?? recordNumber(view, 'preferredHeight')
    ?? recordNumber(record, 'preferredHeight'),
  );
  const viewUrl = recordString(view, 'url') ?? recordString(view, 'entryUrl') ?? recordString(record, 'url');
  const viewId = recordString(view, 'id') ?? recordString(view, 'docId') ?? recordString(record, 'viewId');
  if (viewUrl) {
    return {
      kind: 'canvas',
      surface: 'assistant_message',
      render: 'url',
      url: viewUrl,
      viewId,
      title,
      preferredHeight,
      className: recordString(presentation, 'class_name') ?? recordString(presentation, 'className') ?? recordString(record, 'className'),
      style: recordString(presentation, 'style') ?? recordString(record, 'style'),
    };
  }
  if (recordString(source, 'type')?.toLowerCase() === 'url') {
    const url = recordString(source, 'url');
    if (!url) return undefined;
    return {
      kind: 'canvas',
      surface: 'assistant_message',
      render: 'url',
      url,
      title,
      preferredHeight,
    };
  }
  return undefined;
}

export function extractToolPreview(outputText: string | undefined): ToolCard['preview'] | undefined {
  return coerceCanvasPreview(parseJsonRecord(outputText));
}

function parseEmbedAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const key = match[1]?.trim().toLowerCase();
    const value = (match[2] ?? match[3] ?? '').trim();
    if (key && value) attrs[key] = value;
  }
  return attrs;
}

function canvasPreviewFromEmbed(attrs: Record<string, string>): ToolCard['preview'] | undefined {
  if (attrs.target && attrs.target !== 'assistant_message') return undefined;
  const ref = attrs.ref?.trim();
  const url = attrs.url?.trim() || (ref ? `/__openclaw__/canvas/documents/${encodeURIComponent(ref)}/index.html` : undefined);
  if (!url) return undefined;
  const height = attrs.height && Number.isFinite(Number(attrs.height)) ? normalizeCanvasHeight(Number(attrs.height)) : undefined;
  return {
    kind: 'canvas',
    surface: 'assistant_message',
    render: 'url',
    url,
    viewId: ref,
    title: attrs.title?.trim() || undefined,
    preferredHeight: height,
    className: attrs.class?.trim() || attrs.class_name?.trim() || undefined,
    style: attrs.style?.trim() || undefined,
  };
}

function extractCanvasShortcodes(text: string): { text: string; previews: NonNullable<ToolCard['preview']>[] } {
  if (!text.toLowerCase().includes('[embed')) return { text, previews: [] };
  const previews: NonNullable<ToolCard['preview']>[] = [];
  const stripped = text.replace(/\[embed\s+([^\]]*?)(?:\/\]|]([\s\S]*?)\[\/embed\])/gi, (match, rawAttrs: string) => {
    const preview = canvasPreviewFromEmbed(parseEmbedAttributes(rawAttrs));
    if (!preview) return match;
    previews.push(preview);
    return '';
  });
  return { text: stripped.replace(/\n{3,}/g, '\n\n').trim(), previews };
}

function expandAssistantTextContent(text: string): NormalizedContentItem[] {
  const extracted = extractCanvasShortcodes(text);
  const parsed = parseMediaSegments(extracted.text);
  const items: NormalizedContentItem[] = [];
  if (parsed.text.trim()) items.push({ type: 'text', text: parsed.text });
  for (const attachment of parsed.attachments) items.push({ type: 'attachment', attachment });
  for (const preview of extracted.previews) items.push({ type: 'canvas', preview, rawText: null });
  return items;
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
    content = role === 'assistant'
      ? expandAssistantTextContent(m.content)
      : [{ type: 'text', text: m.content }];
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
        const preview = coerceCanvasPreview(item.preview as Record<string, unknown>) ?? item.preview as Record<string, unknown>;
        return [{
          type: 'canvas',
          preview: {
            kind: typeof preview.kind === 'string' ? preview.kind : undefined,
            surface: typeof preview.surface === 'string' ? preview.surface : undefined,
            render: typeof preview.render === 'string' ? preview.render : undefined,
            url: typeof preview.url === 'string' ? preview.url : undefined,
            viewId: typeof preview.viewId === 'string' ? preview.viewId : undefined,
            title: typeof preview.title === 'string' ? preview.title : undefined,
            preferredHeight: typeof preview.preferredHeight === 'number' ? preview.preferredHeight : undefined,
            className: typeof preview.className === 'string' ? preview.className : undefined,
            style: typeof preview.style === 'string' ? preview.style : undefined,
          },
          rawText: typeof item.rawText === 'string' ? item.rawText : null,
        }];
      }
      if (item.type === 'text' && typeof item.text === 'string' && role === 'assistant') {
        return expandAssistantTextContent(item.text);
      }
      return [{
        type: (item.type as string) || 'text',
        text: item.text as string | undefined,
        name: item.name as string | undefined,
        args: item.args ?? item.input,
        arguments: item.arguments,
      }];
    });
  } else if (typeof m.text === 'string') {
    content = role === 'assistant'
      ? expandAssistantTextContent(m.text)
      : [{ type: 'text', text: m.text }];
  }

  return {
    role,
    content,
    timestamp: toDisplayTimestampMs(m.timestamp),
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

function appendCanvasBlockToAssistantMessage(
  message: RawMessage,
  preview: NonNullable<ToolCard['preview']>,
  rawText: string | null,
): RawMessage {
  const raw = message as unknown as Record<string, unknown>;
  const existingContent = Array.isArray(raw.content)
    ? [...raw.content]
    : typeof raw.content === 'string'
      ? [{ type: 'text', text: raw.content }]
      : typeof raw.text === 'string'
        ? [{ type: 'text', text: raw.text }]
        : [];
  const alreadyHasArtifact = existingContent.some((block) => {
    if (!block || typeof block !== 'object') return false;
    const typed = block as {
      type?: unknown;
      preview?: { kind?: unknown; viewId?: unknown; url?: unknown };
    };
    return (
      typed.type === 'canvas'
      && typed.preview?.kind === 'canvas'
      && ((preview.viewId && typed.preview.viewId === preview.viewId)
        || (preview.url && typed.preview.url === preview.url))
    );
  });
  if (alreadyHasArtifact) return message;
  return {
    ...raw,
    content: [
      ...existingContent,
      {
        type: 'canvas',
        preview,
        ...(rawText ? { rawText } : {}),
      },
    ],
  } as unknown as RawMessage;
}

function extractChatMessagePreview(toolMessage: RawMessage): {
  preview: NonNullable<ToolCard['preview']>;
  text: string | null;
  timestamp: number | null;
} | null {
  const cards = extractToolCards(toolMessage, 'preview');
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (card?.preview?.kind === 'canvas') {
      return {
        preview: card.preview,
        text: card.outputText ?? null,
        timestamp: normalizeMessage(toolMessage).timestamp ?? null,
      };
    }
  }
  const text = extractText(toolMessage) || undefined;
  const preview = extractToolPreview(text);
  if (preview?.kind !== 'canvas') return null;
  return { preview, text: text ?? null, timestamp: normalizeMessage(toolMessage).timestamp ?? null };
}

function findNearestAssistantMessageIndex(
  items: ChatItem[],
  toolTimestamp: number | null,
): number | null {
  const assistantEntries = items
    .map((item, index) => {
      if (item.kind !== 'message') return null;
      const role = typeof item.message.role === 'string' ? item.message.role.toLowerCase() : '';
      if (role !== 'assistant') return null;
      return { index, timestamp: normalizeMessage(item.message).timestamp ?? null };
    })
    .filter(Boolean) as Array<{ index: number; timestamp: number | null }>;
  if (assistantEntries.length === 0) return null;
  if (toolTimestamp == null) return assistantEntries[assistantEntries.length - 1]?.index ?? null;
  let previous: { index: number; timestamp: number } | null = null;
  let next: { index: number; timestamp: number } | null = null;
  for (const entry of assistantEntries) {
    if (entry.timestamp == null) continue;
    if (entry.timestamp <= toolTimestamp) {
      previous = { index: entry.index, timestamp: entry.timestamp };
      continue;
    }
    next = { index: entry.index, timestamp: entry.timestamp };
    break;
  }
  if (previous && next) {
    const previousDelta = toolTimestamp - previous.timestamp;
    const nextDelta = next.timestamp - toolTimestamp;
    return nextDelta < previousDelta ? next.index : previous.index;
  }
  if (previous) return previous.index;
  if (next) return next.index;
  return assistantEntries[assistantEntries.length - 1]?.index ?? null;
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

  const liftedCanvasSources = params.toolMessages
    .map((tool) => extractChatMessagePreview(tool))
    .filter((entry): entry is NonNullable<ReturnType<typeof extractChatMessagePreview>> => Boolean(entry));
  for (const liftedCanvasSource of liftedCanvasSources) {
    const assistantIndex = findNearestAssistantMessageIndex(transcriptItems, liftedCanvasSource.timestamp);
    if (assistantIndex == null) continue;
    const item = transcriptItems[assistantIndex];
    if (!item || item.kind !== 'message') continue;
    transcriptItems[assistantIndex] = {
      ...item,
      message: appendCanvasBlockToAssistantMessage(
        item.message,
        liftedCanvasSource.preview,
        liftedCanvasSource.text,
      ),
    };
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

  const streamSegments = Array.isArray(params.streamSegments) ? params.streamSegments : [];
  const toolMessages = params.showThinking && Array.isArray(params.toolMessages) ? params.toolMessages : [];
  const liveCount = Math.max(streamSegments.length, toolMessages.length);
  for (let i = 0; i < liveCount; i += 1) {
    const segment = streamSegments[i];
    if (segment) {
      const text = segment.text.trim();
      if (text) {
        liveItems.push({
          kind: 'stream',
          key: `stream-segment:${params.sessionKey}:${i}`,
          text,
          startedAt: segment.ts,
        });
      }
    }

    const message = toolMessages[i];
    if (message) {
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

function normalizeContent(content: unknown): Array<Record<string, unknown>> {
  return Array.isArray(content) ? content.filter(Boolean) as Array<Record<string, unknown>> : [];
}

function coerceToolArgs(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function serializeToolInput(args: unknown): string | undefined {
  if (args == null) return undefined;
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    if (typeof args === 'number' || typeof args === 'boolean' || typeof args === 'bigint') return String(args);
    if (typeof args === 'symbol') return args.description ? `Symbol(${args.description})` : 'Symbol()';
    return Object.prototype.toString.call(args);
  }
}

function extractToolText(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  return undefined;
}

function resolveToolCardId(
  item: Record<string, unknown>,
  message: Record<string, unknown>,
  index: number,
  prefix = 'tool',
): string {
  const explicitId =
    (typeof item.id === 'string' && item.id.trim())
    || (typeof item.toolCallId === 'string' && item.toolCallId.trim())
    || (typeof item.tool_call_id === 'string' && item.tool_call_id.trim())
    || (typeof item.callId === 'string' && item.callId.trim())
    || (typeof message.toolCallId === 'string' && message.toolCallId.trim())
    || (typeof message.tool_call_id === 'string' && message.tool_call_id.trim())
    || '';
  if (explicitId) return `${prefix}:${explicitId}`;
  const name =
    (typeof item.name === 'string' && item.name.trim())
    || (typeof message.toolName === 'string' && message.toolName.trim())
    || (typeof message.tool_name === 'string' && message.tool_name.trim())
    || 'tool';
  return `${prefix}:${name}:${index}`;
}

function findLatestToolCard(cards: ToolCard[], id: string, name: string): ToolCard | undefined {
  for (let i = cards.length - 1; i >= 0; i -= 1) {
    const card = cards[i];
    if (card?.id === id || (card?.name === name && !card.outputText)) return card;
  }
  return undefined;
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

export function extractToolCards(message: RawMessage, prefix = 'tool'): ToolCard[] {
  const m = message as unknown as Record<string, unknown>;
  const content = normalizeContent(m.content);
  const cards: ToolCard[] = [];

  for (let index = 0; index < content.length; index += 1) {
    const item = content[index] ?? {};
    const kind = (typeof item.type === 'string' ? item.type : '').toLowerCase();
    const isToolCall =
      ['toolcall', 'tool_call', 'tooluse', 'tool_use'].includes(kind)
      || (typeof item.name === 'string' && (item.arguments != null || item.args != null || item.input != null));
    if (isToolCall) {
      const args = coerceToolArgs(item.arguments ?? item.args ?? item.input);
      cards.push({
        id: resolveToolCardId(item, m, index, prefix),
        kind: 'call',
        name: (item.name as string) ?? 'tool',
        args,
        inputText: serializeToolInput(args),
      });
      continue;
    }

    if (kind === 'toolresult' || kind === 'tool_result') {
      const name = typeof item.name === 'string' ? item.name : 'tool';
      const id = resolveToolCardId(item, m, index, prefix);
      const existing = findLatestToolCard(cards, id, name);
      const text = extractToolText(item);
      const preview = extractToolPreview(text);
      if (existing) {
        existing.kind = existing.kind ?? 'result';
        existing.outputText = text;
        existing.text = text;
        existing.preview = preview;
        continue;
      }
      cards.push({ id, kind: 'result', name, outputText: text, text, preview });
    }
  }

  const lowerRole = typeof m.role === 'string' ? m.role.toLowerCase() : '';
  const isStandaloneToolMessage =
    lowerRole === 'toolresult'
    || lowerRole === 'tool_result'
    || lowerRole === 'tool'
    || lowerRole === 'function'
    || typeof m.toolName === 'string'
    || typeof m.tool_name === 'string';
  if (isStandaloneToolMessage && cards.length === 0) {
    const name =
      (typeof m.toolName === 'string' && m.toolName)
      || (typeof m.tool_name === 'string' && m.tool_name)
      || 'tool';
    const text = extractText(message) || undefined;
    cards.push({
      id: resolveToolCardId({}, m, 0, prefix),
      kind: 'result',
      name,
      outputText: text,
      text,
      preview: extractToolPreview(text),
    });
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
