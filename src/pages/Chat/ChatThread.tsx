import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { AlertCircle, Bot, Check, Copy, FileText, RotateCcw, Search, Trash2, User, X, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { RawMessage, StreamSegment } from '@/stores/chat';
import { extractImages, extractText } from './message-utils';
import { toSanitizedMarkdownHtml } from './markdown';
import { detectTextDirection } from './text-direction';
import {
  type ToolCard,
  type ChatThreadLabels,
  type GroupMeta,
  type MessageGroup,
  type NormalizedContentItem,
  type TranscriptEntry,
  buildAssistantAttachmentUrl,
  buildChatItems,
  detectJson,
  extractGroupMeta,
  extractGroupSearchText,
  extractToolCards,
  formatArgs,
  formatChatTime,
  getReasoningMarkdown,
  hasVisibleMessageContent,
  jsonSummaryLabel,
  makeStreamMessage,
  normalizeMessage,
  normalizeRoleForGrouping,
  previewText,
  resolveToolDisplay,
  toDisplayTimestampMs,
} from './chat-thread-view-model';

const hiddenGroupsBySession = new Map<string, Set<string>>();
const deletedGroupOrderBySession = new Map<string, string[]>();
const expandedToolMessagesBySession = new Map<string, Map<string, boolean>>();
const expandedToolCardsBySession = new Map<string, Map<string, boolean>>();

function getHiddenGroups(sessionKey: string): Set<string> {
  const existing = hiddenGroupsBySession.get(sessionKey);
  if (existing) return existing;
  const next = new Set<string>();
  hiddenGroupsBySession.set(sessionKey, next);
  return next;
}

function getExpandedToolMessages(sessionKey: string): Map<string, boolean> {
  const existing = expandedToolMessagesBySession.get(sessionKey);
  if (existing) return existing;
  const next = new Map<string, boolean>();
  expandedToolMessagesBySession.set(sessionKey, next);
  return next;
}

function getExpandedToolCards(sessionKey: string): Map<string, boolean> {
  const existing = expandedToolCardsBySession.get(sessionKey);
  if (existing) return existing;
  const next = new Map<string, boolean>();
  expandedToolCardsBySession.set(sessionKey, next);
  return next;
}

function getDeletedGroupOrder(sessionKey: string): string[] {
  const existing = deletedGroupOrderBySession.get(sessionKey);
  if (existing) return existing;
  const next: string[] = [];
  deletedGroupOrderBySession.set(sessionKey, next);
  return next;
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

const ToolCards = memo(function ToolCards({
  cards,
  labels,
  messageKey,
  isExpanded,
  onToggle,
}: {
  cards: ToolCard[];
  labels: ChatThreadLabels;
  messageKey: string;
  isExpanded: (toolCardId: string) => boolean;
  onToggle: (toolCardId: string) => void;
}) {
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
          <ToolCardItem
            key={`${card.kind}:${card.name}:${index}`}
            card={card}
            labels={labels}
            expanded={isExpanded(`${messageKey}:toolcard:${index}`)}
            onToggle={() => onToggle(`${messageKey}:toolcard:${index}`)}
          />
        ))}
      </div>
    </details>
  );
});

const ToolCardItem = memo(function ToolCardItem({
  card,
  labels,
  expanded,
  onToggle,
}: {
  card: ToolCard;
  labels: ChatThreadLabels;
  expanded: boolean;
  onToggle: () => void;
}) {
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
            onClick={onToggle}
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

const UserFileAttachments = memo(function UserFileAttachments({ message }: { message: RawMessage }) {
  const files = (message._attachedFiles || []).filter((file) => !file.mimeType.startsWith('image/'));
  if (files.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((file, index) => (
        <div
          key={`${file.filePath || file.fileName}:${index}`}
          className="flex max-w-[220px] items-center gap-2 rounded-[12px] border border-black/8 bg-black/4 px-2.5 py-2 dark:border-white/10 dark:bg-white/5"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-black/6 text-muted-foreground dark:bg-white/8">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{file.fileName}</div>
            <div className="text-[10px] text-muted-foreground">
              {file.fileSize > 0 ? `${(file.fileSize / 1024).toFixed(file.fileSize >= 10240 ? 0 : 1)} KB` : file.mimeType}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});

const AssistantAttachments = memo(function AssistantAttachments({ message }: { message: RawMessage }) {
  const normalized = normalizeMessage(message);
  const attachments = normalized.content
    .filter((item): item is NormalizedContentItem & { attachment: NonNullable<NormalizedContentItem['attachment']> } => item.type === 'attachment' && Boolean(item.attachment))
    .map((item) => item.attachment);

  if (attachments.length === 0) return null;

  return (
    <div className="chat-assistant-attachments">
      {attachments.map((attachment, index) => {
        const src = buildAssistantAttachmentUrl(attachment.url);
        if (attachment.kind === 'image') {
          return (
            <img
              key={`${attachment.url}:${index}`}
              className="chat-message-image"
              src={src}
              alt={attachment.label}
              onClick={() => { void invokeIpc('shell:openExternal', src); }}
            />
          );
        }
        if (attachment.kind === 'audio') {
          return (
            <div key={`${attachment.url}:${index}`} className="chat-assistant-attachment-card chat-assistant-attachment-card--audio">
              <div className="chat-assistant-attachment-card__header">
                <span className="chat-assistant-attachment-card__title">{attachment.label}</span>
                {attachment.isVoiceNote ? <span className="chat-assistant-attachment-badge">Voice note</span> : null}
              </div>
              <audio controls preload="metadata" src={src} />
            </div>
          );
        }
        if (attachment.kind === 'video') {
          return (
            <div key={`${attachment.url}:${index}`} className="chat-assistant-attachment-card chat-assistant-attachment-card--video">
              <video controls preload="metadata" src={src} />
              <a
                className="chat-assistant-attachment-card__link"
                href={src}
                target="_blank"
                rel="noreferrer"
              >
                {attachment.label}
              </a>
            </div>
          );
        }
        return (
          <div key={`${attachment.url}:${index}`} className="chat-assistant-attachment-card">
            <a
              className="chat-assistant-attachment-card__link"
              href={src}
              target="_blank"
              rel="noreferrer"
            >
              {attachment.label}
            </a>
          </div>
        );
      })}
    </div>
  );
});

const GroupedMessage = memo(function GroupedMessage({
  message,
  messageKey,
  isStreaming,
  showThinking,
  labels,
  toolMessageExpanded,
  onToggleToolMessage,
  isToolCardExpanded,
  onToggleToolCard,
}: {
  message: RawMessage;
  messageKey: string;
  isStreaming: boolean;
  showThinking: boolean;
  labels: ChatThreadLabels;
  toolMessageExpanded: boolean;
  onToggleToolMessage: () => void;
  isToolCardExpanded: (toolCardId: string) => boolean;
  onToggleToolCard: (toolCardId: string) => void;
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
  const reasoningMarkdown = role === 'assistant'
    ? getReasoningMarkdown(message, showThinking, labels)
    : null;
  const canCopyMarkdown = role === 'assistant' && Boolean(markdown.trim());
  const jsonResult = markdown && !isStreaming ? detectJson(markdown) : null;
  const visibleToolCards = showThinking && hasToolCards;

  if (!showThinking && (normalizedRole === 'tool' || isToolResult) && !markdown.trim()) {
    return null;
  }

  if (!markdown && visibleToolCards && isToolResult) {
    return (
      <ToolCards
        cards={toolCards}
        labels={labels}
        messageKey={messageKey}
        isExpanded={isToolCardExpanded}
        onToggle={onToggleToolCard}
      />
    );
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
          <summary
            className="chat-tool-msg-summary"
            onClick={(event) => {
              event.preventDefault();
              onToggleToolMessage();
            }}
          >
            <span className="chat-tool-msg-summary__icon"><Zap className="h-3.5 w-3.5" /></span>
            <span className="chat-tool-msg-summary__label">{labels.toolOutput}</span>
            {toolSummaryLabel ? <span className="chat-tool-msg-summary__names">{toolSummaryLabel}</span> : null}
            {!toolSummaryLabel && toolPreview ? <span className="chat-tool-msg-summary__preview">{toolPreview}</span> : null}
          </summary>
          {toolMessageExpanded ? (
            <div className="chat-tool-msg-body">
              <MessageImages message={message} />
              {normalizedRole === 'user' ? <UserFileAttachments message={message} /> : null}
              <AssistantAttachments message={message} />
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
              {hasToolCards ? (
                <ToolCards
                  cards={toolCards}
                  labels={labels}
                  messageKey={messageKey}
                  isExpanded={isToolCardExpanded}
                  onToggle={onToggleToolCard}
                />
              ) : null}
            </div>
          ) : null}
        </details>
      ) : (
        <>
          <MessageImages message={message} />
          {normalizedRole === 'user' ? <UserFileAttachments message={message} /> : null}
          <AssistantAttachments message={message} />
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
          {hasToolCards ? (
            <ToolCards
              cards={toolCards}
              labels={labels}
              messageKey={messageKey}
              isExpanded={isToolCardExpanded}
              onToggle={onToggleToolCard}
            />
          ) : null}
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
  onDelete,
  isToolMessageExpanded,
  onToggleToolMessage,
  isToolCardExpanded,
  onToggleToolCard,
}: {
  group: MessageGroup;
  showThinking: boolean;
  labels: ChatThreadLabels;
  contextWindow: number | null;
  locale: string;
  onDelete: () => void;
  isToolMessageExpanded: (messageId: string) => boolean;
  onToggleToolMessage: (messageId: string) => void;
  isToolCardExpanded: (toolCardId: string) => boolean;
  onToggleToolCard: (toolCardId: string) => void;
}) {
  const timestamp = formatChatTime(group.timestamp, locale);
  const label = group.role === 'user'
    ? (group.senderLabel?.trim() || labels.you)
    : group.role === 'assistant'
      ? labels.assistant
      : labels.tool;
  const meta = extractGroupMeta(group, contextWindow);
  const visibleMessages = group.messages.filter((item) => hasVisibleMessageContent(item.message, showThinking));

  if (visibleMessages.length === 0 && !group.hasReadingIndicator) {
    return null;
  }

  return (
    <div className={cn('chat-group', group.role)}>
      <Avatar role={group.role} />
      <div className="chat-group-messages">
        {visibleMessages.map((item, index) => (
          <GroupedMessage
            key={item.key}
            message={item.message}
            messageKey={item.key}
            isStreaming={group.isStreaming && index === visibleMessages.length - 1}
            showThinking={showThinking}
            labels={labels}
            toolMessageExpanded={isToolMessageExpanded(`toolmsg:${item.key}`)}
            onToggleToolMessage={() => onToggleToolMessage(`toolmsg:${item.key}`)}
            isToolCardExpanded={isToolCardExpanded}
            onToggleToolCard={onToggleToolCard}
          />
        ))}
        {group.hasReadingIndicator ? <div className="chat-group-reading"><ReadingIndicator inline /></div> : null}
        <div className="chat-group-footer">
          <span className="chat-sender-name">{label}</span>
          <span className="chat-group-timestamp">{timestamp}</span>
          <MessageMeta meta={meta} labels={labels} />
          <button
            type="button"
            className="chat-group-delete"
            title={labels.delete}
            aria-label={labels.delete}
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
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
          messageKey={`stream:${startedAt}`}
          isStreaming
          showThinking={false}
          labels={labels}
          toolMessageExpanded={false}
          onToggleToolMessage={() => undefined}
          isToolCardExpanded={() => false}
          onToggleToolCard={() => undefined}
        />
        <div className="chat-group-footer">
          <span className="chat-sender-name">{labels.assistant}</span>
          <span className="chat-group-timestamp">{timestamp}</span>
        </div>
      </div>
    </div>
  );
});

const ReadingIndicator = memo(function ReadingIndicator({ inline = false }: { inline?: boolean }) {
  return (
    <div className={cn(!inline && 'chat-group assistant')}>
      {!inline ? <Avatar role="assistant" /> : null}
      <div className={cn(!inline && 'chat-group-messages')}>
        <div
          className={cn(
            'chat-bubble',
            !inline && 'streaming',
            'chat-bubble--reading'
          )}
          aria-hidden="true"
        >
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

const TranscriptNotice = memo(function TranscriptNotice({
  message,
  detail,
  icon,
}: {
  message: string;
  detail?: string;
  icon?: 'alert';
}) {
  return (
    <div className="context-notice">
      {icon === 'alert' ? <AlertCircle className="context-notice__icon" /> : null}
      <span>{message}</span>
      {detail ? <span className="context-notice__detail">{detail}</span> : null}
    </div>
  );
});

const TranscriptDivider = memo(function TranscriptDivider({ label }: { label: string }) {
  return (
    <div className="chat-divider" role="separator">
      <span className="chat-divider__line" />
      <span className="chat-divider__label">{label}</span>
      <span className="chat-divider__line" />
    </div>
  );
});

const BtwBubble = memo(function BtwBubble({
  message,
  labels,
  onDismiss,
}: {
  message: RawMessage;
  labels: ChatThreadLabels;
  onDismiss: () => void;
}) {
  const content = extractText(message);
  const btwInfo = message.btw;
  const question = btwInfo?.question ?? '';

  return (
    <div className="btw-bubble">
      <div className="btw-bubble__header">
        <div className="btw-bubble__title">
          <span className="btw-bubble__tag">{labels.btw}</span>
          <span className="btw-bubble__meta">{labels.btwEphemeral}</span>
        </div>
        <button type="button" className="btw-bubble__dismiss" onClick={onDismiss} title={labels.dismiss}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {question && <div className="btw-bubble__question">{question}</div>}
      {content && (
        <div
          className="btw-bubble__content"
          dangerouslySetInnerHTML={{ __html: toSanitizedMarkdownHtml(content) }}
        />
      )}
    </div>
  );
});

export const ChatThread = memo(function ChatThread({
  messages,
  pendingUserMessage,
  pendingAssistantMessage,
  btwMessages,
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
  searchQuery,
  onSearchChange,
  hideSearch,
}: {
  messages: RawMessage[];
  pendingUserMessage: RawMessage | null;
  pendingAssistantMessage: RawMessage | null;
  btwMessages: RawMessage[];
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
  searchQuery: string;
  onSearchChange: (q: string) => void;
  hideSearch?: boolean;
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
    loadingEarlier: t('thread.loadingEarlier', 'Loading earlier messages'),
    btw: t('thread.btw', 'Side answer'),
    btwEphemeral: t('thread.btwEphemeral', 'Not saved to chat history'),
    dismiss: t('common:actions.dismiss', 'Dismiss'),
    delete: t('common:actions.delete', 'Delete'),
    searchPlaceholder: t('common:actions.search', 'Search'),
    noResults: t('common:status.noResults', 'No matching messages'),
    deletedHidden: t('thread.deletedHidden', 'Hidden messages'),
    restore: t('common:actions.restore', 'Restore'),
  }), [resolvedAssistantName, t]);
  const [dismissedBtwAt, setDismissedBtwAt] = useState<number | null>(null);
  const [uiVersion, setUiVersion] = useState(0);

  const hasCompactionSummary = useMemo(
    () => messages.some((message) => message.role === 'compactionSummary'),
    [messages]
  );

  const items = useMemo(() => buildChatItems({
    messages,
    pendingUserMessage,
    pendingAssistantMessage,
    toolMessages,
    streamSegments,
    streamingMessage,
    streamingStartedAt,
    sessionKey,
    sending,
    pendingFinal,
    showThinking,
    locale,
  }), [locale, messages, pendingUserMessage, pendingAssistantMessage, toolMessages, streamSegments, streamingMessage, streamingStartedAt, sessionKey, sending, pendingFinal, showThinking]);

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
  const latestBtwMessage = useMemo(() => {
    const latest = btwMessages[btwMessages.length - 1] ?? null;
    if (!latest) return null;
    const ts = latest.timestamp ? toDisplayTimestampMs(latest.timestamp) : 0;
    if (dismissedBtwAt && ts <= dismissedBtwAt) {
      return null;
    }
    return latest;
  }, [btwMessages, dismissedBtwAt]);
  useEffect(() => {
    queueMicrotask(() => setDismissedBtwAt(null));
  }, [sessionKey]);
  const hiddenGroups = useMemo(() => getHiddenGroups(sessionKey), [sessionKey]);
  const deletedGroupOrder = useMemo(() => getDeletedGroupOrder(sessionKey), [sessionKey]);
  const expandedToolMessages = useMemo(() => getExpandedToolMessages(sessionKey), [sessionKey]);
  const expandedToolCards = useMemo(() => getExpandedToolCards(sessionKey), [sessionKey]);

  const isToolMessageExpanded = (messageId: string): boolean => expandedToolMessages.get(messageId) ?? false;
  const onToggleToolMessage = (messageId: string): void => {
    expandedToolMessages.set(messageId, !(expandedToolMessages.get(messageId) ?? false));
    setUiVersion((value) => value + 1);
  };
  const isToolCardExpanded = (toolCardId: string): boolean => expandedToolCards.get(toolCardId) ?? false;
  const onToggleToolCard = (toolCardId: string): void => {
    expandedToolCards.set(toolCardId, !(expandedToolCards.get(toolCardId) ?? false));
    setUiVersion((value) => value + 1);
  };
  void uiVersion;

  const systemEntries = useMemo<Array<Extract<TranscriptEntry, { kind: 'notice' | 'side-result' }>>>(() => {
    const entries: Array<Extract<TranscriptEntry, { kind: 'notice' | 'side-result' }>> = [];
    if (contextNotice) {
      entries.push({
        kind: 'notice',
        key: 'notice:context',
        message: `${contextNotice.pct}% context used`,
        detail: `${contextNotice.used.toLocaleString()} / ${contextNotice.limit.toLocaleString()}`,
      });
    }
    if (historyWindowLimited) {
      entries.push({
        kind: 'notice',
        key: 'notice:history-window',
        icon: 'alert',
        message: loadingEarlierHistory ? labels.loadingEarlier : labels.historyWindowLimited,
        detail: canLoadEarlier && !loadingEarlierHistory ? '↑' : undefined,
      });
    }
    if (hasCompactionSummary) {
      entries.push({
        kind: 'notice',
        key: 'notice:history-compacted',
        icon: 'alert',
        message: labels.historyCompacted,
      });
    }
    if (latestBtwMessage) {
      entries.push({
        kind: 'side-result',
        key: `side-result:${latestBtwMessage.timestamp ?? 'latest'}`,
        message: latestBtwMessage,
      });
    }
    return entries;
  }, [
    canLoadEarlier,
    contextNotice,
    hasCompactionSummary,
    historyWindowLimited,
    labels.historyCompacted,
    labels.historyWindowLimited,
    labels.loadingEarlier,
    latestBtwMessage,
    loadingEarlierHistory,
  ]);

  const transcriptEntries = useMemo<TranscriptEntry[]>(
    () => items.filter((item) => item.kind !== 'stream' && item.kind !== 'reading-indicator'),
    [items],
  );
  const liveActivityEntries = useMemo<Array<Extract<TranscriptEntry, { kind: 'stream' | 'reading-indicator' }>>>(
    () => items.filter((item) => item.kind === 'stream' || item.kind === 'reading-indicator'),
    [items],
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedSearchQuery) {
      return transcriptEntries;
    }
    return transcriptEntries.filter((item) => {
      if (item.kind === 'group') {
        return extractGroupSearchText(item).includes(normalizedSearchQuery);
      }
      if (item.kind === 'stream') {
        return item.text.toLowerCase().includes(normalizedSearchQuery);
      }
      if (item.kind === 'side-result') {
        return extractText(item.message).toLowerCase().includes(normalizedSearchQuery);
      }
      return false;
    });
  }, [normalizedSearchQuery, transcriptEntries]);
  const visibleTranscriptEntries = useMemo(() => {
    if (!normalizedSearchQuery) {
      return transcriptEntries;
    }
    return filteredEntries.filter((item, index, entries) => {
      if (item.kind !== 'divider') {
        return true;
      }
      const next = entries[index + 1];
      return Boolean(next && next.kind !== 'divider');
    });
  }, [filteredEntries, normalizedSearchQuery, transcriptEntries]);

  return (
    <div className="openclaw-chat-thread">
      {!hideSearch ? (
      <div className="chat-thread-search">
        <Search className="chat-thread-search__icon h-3.5 w-3.5" />
        <input
          type="text"
          className="chat-thread-search__input"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
        />
        {searchQuery ? (
          <button
            type="button"
            className="chat-thread-search__clear"
            onClick={() => onSearchChange('')}
            title={labels.dismiss}
            aria-label={labels.dismiss}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      ) : null}
      {deletedGroupOrder.length > 0 ? (
        <div className="context-notice">
          <span>{labels.deletedHidden}: {deletedGroupOrder.length}</span>
          <button
            type="button"
            className="chat-thread-restore"
            onClick={() => {
              const last = deletedGroupOrder.pop();
              if (last) {
                hiddenGroups.delete(last);
                setUiVersion((value) => value + 1);
              }
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{labels.restore}</span>
          </button>
        </div>
      ) : null}
      {normalizedSearchQuery && visibleTranscriptEntries.length === 0 ? (
        <div className="chat-thread-empty-search">{labels.noResults}</div>
      ) : null}
      {!normalizedSearchQuery ? systemEntries.map((item) => {
        if (item.kind === 'notice') {
          return <TranscriptNotice key={item.key} message={item.message} detail={item.detail} icon={item.icon} />;
        }
        return (
          <BtwBubble
            key={item.key}
            message={item.message}
            labels={labels}
            onDismiss={() => setDismissedBtwAt(toDisplayTimestampMs(item.message.timestamp ?? Date.now()))}
          />
        );
      }) : null}
      {visibleTranscriptEntries.map((item) => {
        if (item.kind === 'divider') {
          return <TranscriptDivider key={item.key} label={item.label} />;
        }
        if (item.kind === 'group') {
          if (hiddenGroups.has(item.key)) {
            return null;
          }
          return (
            <Group
              key={item.key}
              group={item}
              showThinking={showThinking}
              labels={labels}
              contextWindow={contextWindow ?? null}
              locale={locale}
              onDelete={() => {
                hiddenGroups.add(item.key);
                deletedGroupOrder.push(item.key);
                setUiVersion((value) => value + 1);
              }}
              isToolMessageExpanded={isToolMessageExpanded}
              onToggleToolMessage={onToggleToolMessage}
              isToolCardExpanded={isToolCardExpanded}
              onToggleToolCard={onToggleToolCard}
            />
          );
        }
        return null;
      })}
      {!normalizedSearchQuery ? liveActivityEntries.map((item) => {
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
      }) : null}
    </div>
  );
});
