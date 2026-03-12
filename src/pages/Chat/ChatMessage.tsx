/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, useEffect, memo } from 'react';
import { Bot, Copy, Check, ChevronDown, ChevronRight, Wrench, FileText, Film, Music, FileArchive, File, X, FolderOpen, ZoomIn, CheckCircle2, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { extractText, extractThinking, extractImages, extractToolUse, formatTimestamp } from './message-utils';
import { useTranslation } from 'react-i18next';

interface ChatMessageProps {
  message: RawMessage;
  showThinking: boolean;
  isStreaming?: boolean;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}

interface ExtractedImage { url?: string; data?: string; mimeType: string; }

/** Resolve an ExtractedImage to a displayable src string, or null if not possible. */
function imageSrc(img: ExtractedImage): string | null {
  if (img.url) return img.url;
  if (img.data) return `data:${img.mimeType};base64,${img.data}`;
  return null;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  showThinking,
  isStreaming = false,
  streamingTools = [],
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const text = extractText(message);
  const hasText = text.trim().length > 0;
  const thinking = extractThinking(message);
  const images = extractImages(message);
  const tools = extractToolUse(message);
  const visibleThinking = showThinking ? thinking : null;
  const visibleTools = tools;

  const attachedFiles = message._attachedFiles || [];
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);

  // Never render tool result messages in chat UI
  if (isToolResult) return null;

  const hasStreamingToolStatus = isStreaming && streamingTools.length > 0;
  if (!hasText && !visibleThinking && images.length === 0 && visibleTools.length === 0 && attachedFiles.length === 0 && !hasStreamingToolStatus) return null;

  return (
    <div
      className={cn(
        'group flex gap-4',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-slate-200/90 bg-slate-50 text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200">
          <Bot className="h-4 w-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={cn(
          'flex w-full min-w-0 max-w-[82%] flex-col space-y-2.5 lg:max-w-[78%]',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {isStreaming && !isUser && streamingTools.length > 0 && (
          <ToolStatusBar tools={streamingTools} />
        )}

        {/* Thinking section */}
        {visibleThinking && (
          <ThinkingBlock content={visibleThinking} />
        )}

        {/* Tool use cards */}
        {visibleTools.length > 0 && (
          <div className="space-y-1">
            {visibleTools.map((tool, i) => (
              <ToolCard key={tool.id || i} name={tool.name} input={tool.input} />
            ))}
          </div>
        )}

        {/* Images — rendered ABOVE text bubble for user messages */}
        {/* Images from content blocks (Gateway session data / channel push photos) */}
        {isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImageThumbnail
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — images above text for user, file cards below */}
        {isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              // Skip image attachments if we already have images from content blocks
              if (isImage && images.length > 0) return null;
              if (isImage) {
                return file.preview ? (
                  <ImageThumbnail
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                ) : (
                  <div
                    key={`local-${i}`}
                    className="w-36 h-36 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 flex items-center justify-center text-muted-foreground"
                  >
                    <File className="h-8 w-8" />
                  </div>
                );
              }
              // Non-image files → file card
              return <FileCard key={`local-${i}`} file={file} />;
            })}
          </div>
        )}

        {/* Main text bubble */}
        {hasText && (
          <MessageBubble
            text={text}
            isUser={isUser}
            isStreaming={isStreaming}
          />
        )}

        {/* Images from content blocks — assistant messages (below text) */}
        {!isUser && images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImagePreviewCard
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — assistant messages (below text) */}
        {!isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              if (isImage && images.length > 0) return null;
              if (isImage && file.preview) {
                return (
                  <ImagePreviewCard
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                );
              }
              if (isImage && !file.preview) {
                return (
                  <div key={`local-${i}`} className="w-36 h-36 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 flex items-center justify-center text-muted-foreground">
                    <File className="h-8 w-8" />
                  </div>
                );
              }
              return <FileCard key={`local-${i}`} file={file} />;
            })}
          </div>
        )}

        {/* Message meta row */}
        {(hasText || message.timestamp) && (
          <MessageMetaBar
            text={hasText ? text : ''}
            timestamp={message.timestamp}
            align={isUser ? 'end' : 'start'}
          />
        )}
      </div>

      {/* Image lightbox portal */}
      {lightboxImg && (
        <ImageLightbox
          src={lightboxImg.src}
          fileName={lightboxImg.fileName}
          filePath={lightboxImg.filePath}
          base64={lightboxImg.base64}
          mimeType={lightboxImg.mimeType}
          onClose={() => setLightboxImg(null)}
        />
      )}
    </div>
  );
});

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function ToolStatusBar({
  tools,
}: {
  tools: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}) {
  return (
    <div className="w-full space-y-1">
      {tools.map((tool) => {
        const duration = formatDuration(tool.durationMs);
        const isRunning = tool.status === 'running';
        const isError = tool.status === 'error';
        return (
          <div
            key={tool.toolCallId || tool.id || tool.name}
            className={cn(
              'flex items-center gap-2 rounded-[14px] border px-3.5 py-2.5 text-xs shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition-colors',
              isRunning && 'border-sky-200 bg-sky-50 text-slate-800 dark:border-sky-400/25 dark:bg-sky-400/[0.08]',
              !isRunning && !isError && 'border-border/60 bg-card/85 text-muted-foreground',
              isError && 'border-destructive/30 bg-destructive/8 text-destructive',
            )}
          >
            {isRunning && <LoadingIcon className="h-3.5 w-3.5 text-primary shrink-0" />}
            {!isRunning && !isError && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
            {isError && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
            <Wrench className="h-3 w-3 shrink-0 opacity-60" />
            <span className="font-mono text-[12px] font-medium">{tool.name}</span>
            {duration && <span className="text-[11px] opacity-60">{tool.summary ? `(${duration})` : duration}</span>}
            {tool.summary && (
              <span className="truncate text-[11px] opacity-70">{tool.summary}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Assistant hover bar (timestamp + copy, shown on group hover) ─

function MessageMetaBar({
  text,
  timestamp,
  align,
}: {
  text: string;
  timestamp?: number;
  align: 'start' | 'end';
}) {
  const [copied, setCopied] = useState(false);
  const canCopy = text.trim().length > 0;

  const copyContent = useCallback(() => {
    if (!canCopy) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [canCopy, text]);

  return (
    <div
      className={cn(
        'flex w-full items-center gap-2 px-1 pt-1 select-none',
        align === 'end' ? 'justify-end' : 'justify-start',
      )}
    >
      <span className="text-[11px] font-medium text-muted-foreground">
        {timestamp ? formatTimestamp(timestamp) : ''}
      </span>
      {canCopy && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
          onClick={copyContent}
          title="Copy"
        >
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
        </Button>
      )}
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────

function MessageBubble({
  text,
  isUser,
  isStreaming,
}: {
  text: string;
  isUser: boolean;
  isStreaming: boolean;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[16px] border px-4 py-3.5 shadow-[0_14px_38px_rgba(15,23,42,0.06)]',
        !isUser && 'w-full',
        isUser
          ? 'border-sky-500/25 bg-[linear-gradient(135deg,#2563eb_0%,#2f6fe6_55%,#3b82f6_100%)] text-white'
          : 'border-slate-200/80 bg-slate-50 text-foreground dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.07)_0%,rgba(255,255,255,0.04)_100%)]',
      )}
    >
      {isUser ? (
        <>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_42%)]" />
          <p className="relative whitespace-pre-wrap break-words break-all text-[14px] leading-6">{text}</p>
        </>
      ) : (
        <div className="prose prose-sm max-w-none break-words break-all text-foreground dark:prose-invert prose-headings:mb-3 prose-headings:mt-5 prose-headings:font-semibold prose-p:leading-7 prose-pre:border prose-pre:border-black/5 prose-pre:bg-black/[0.04] prose-pre:shadow-none prose-strong:text-foreground dark:prose-pre:border-white/10 dark:prose-pre:bg-white/[0.05]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !className;
                if (isInline) {
                  return (
                    <code className="rounded-md bg-black/[0.06] px-1.5 py-0.5 text-sm font-mono break-words break-all dark:bg-white/[0.08]" {...props}>
                      {children}
                    </code>
                  );
                }
                return (
                  <pre className="overflow-x-auto rounded-2xl p-4">
                    <code className={cn('text-sm font-mono', className)} {...props}>
                      {children}
                    </code>
                  </pre>
                );
              },
              a({ href, children }) {
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-sky-600 underline-offset-4 hover:underline break-words break-all dark:text-sky-400">
                    {children}
                  </a>
                );
              },
            }}
          >
            {text}
          </ReactMarkdown>
          {isStreaming && (
            <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-full bg-foreground/40" />
          )}
        </div>
      )}

    </div>
  );
}

// ── Thinking Block ──────────────────────────────────────────────

function ThinkingBlock({ content }: { content: string }) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full overflow-hidden rounded-[14px] border border-slate-200/80 bg-slate-50/90 text-[14px] shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-white/[0.04]">
      <button
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-slate-500 transition-colors hover:text-foreground dark:text-slate-300/80"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="font-medium">{t('message.thinking')}</span>
      </button>
      {expanded && (
        <div className="px-3.5 pb-3.5 text-muted-foreground">
          <div className="prose prose-sm max-w-none opacity-80 dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ── File Card (for user-uploaded non-image files) ───────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

function FileCard({ file }: { file: AttachedFileMeta }) {
  const { t } = useTranslation('chat');
  return (
    <div className="flex max-w-[240px] items-center gap-3 rounded-[14px] border border-slate-200/80 bg-slate-50 px-3.5 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-white/[0.05]">
      <FileIcon mimeType={file.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 overflow-hidden">
        <p className="text-xs font-medium truncate">{file.fileName}</p>
        <p className="text-[10px] text-muted-foreground">
          {file.fileSize > 0 ? formatFileSize(file.fileSize) : t('message.file')}
        </p>
      </div>
    </div>
  );
}

// ── Image Thumbnail (user bubble — square crop with zoom hint) ──

function ImageThumbnail({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className="group/img relative h-36 w-36 cursor-zoom-in overflow-hidden rounded-[14px] border border-slate-200/80 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.04]"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="w-full h-full object-cover" />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/img:bg-black/25">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Preview Card (assistant bubble — natural size with overlay actions) ──

function ImagePreviewCard({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <div
      className="group/img relative max-w-xs cursor-zoom-in overflow-hidden rounded-[14px] border border-slate-200/80 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.04]"
      onClick={onPreview}
    >
      <img src={src} alt={fileName} className="block w-full" />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/img:bg-black/20">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </div>
  );
}

// ── Image Lightbox ───────────────────────────────────────────────

function ImageLightbox({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onClose,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('chat');
  void src; void base64; void mimeType; void fileName;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleShowInFolder = useCallback(() => {
    if (filePath) {
      invokeIpc('shell:showItemInFolder', filePath);
    }
  }, [filePath]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      {/* Image + buttons stacked */}
      <div
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={fileName}
          className="max-h-[85vh] max-w-[90vw] rounded-[14px] border border-white/10 object-contain shadow-2xl"
        />

        {/* Action buttons below image */}
        <div className="flex items-center gap-2">
          {filePath && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
              onClick={handleShowInFolder}
              title={t('message.showInFolder')}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={onClose}
            title={t('message.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Tool Card ───────────────────────────────────────────────────

function ToolCard({ name, input }: { name: string; input: unknown }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-[14px] border border-slate-200/80 bg-slate-50 text-[14px] shadow-[0_10px_24px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-white/[0.04]">
      <button
        className="flex w-full items-center gap-2 px-3.5 py-2 text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
        <Wrench className="h-3 w-3 shrink-0 opacity-60" />
        <span className="font-mono text-xs">{name}</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && input != null && (
        <pre className="overflow-x-auto px-3.5 pb-3 text-xs text-muted-foreground">
          {typeof input === 'string' ? input : JSON.stringify(input, null, 2) as string}
        </pre>
      )}
    </div>
  );
}
