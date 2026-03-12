/**
 * Chat Input Component
 * Textarea with send button and universal file upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged to disk via IPC 鈥?only lightweight path references
 * are sent with the message (no base64 over WebSocket).
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  SendHorizontal,
  Square,
  X,
  Paperclip,
  Check,
  ChevronsUpDown,
  Trash2,
  FileText,
  Film,
  Music,
  FileArchive,
  File,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
import { Textarea } from '@/components/ui/textarea';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { Brain } from 'lucide-react';

// 鈹€鈹€ Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string; // disk path for gateway
  preview: string | null; // data URL for images, null for others
  status: 'staging' | 'ready' | 'error';
  error?: string;
}

export interface ChatAgentOption {
  id: string;
  label: string;
}

interface ChatInputProps {
  onSend: (text: string, attachments?: FileAttachment[]) => void;
  onStop?: () => void;
  onToggleThinking?: () => void;
  resetKey?: string;
  modelOptions?: Array<{ value: string; label: string; shortLabel: string }>;
  selectedModel?: string;
  defaultModelValue?: string;
  defaultModelShortLabel?: string;
  onModelChange?: (model?: string) => void | Promise<void>;
  onConfigureModels?: () => void;
  modelDisabled?: boolean;
  disabled?: boolean;
  sending?: boolean;
  isEmpty?: boolean;
  showThinking?: boolean;
}

// 鈹€鈹€ Helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  )
    return <FileText className={className} />;
  if (
    mimeType.includes('zip') ||
    mimeType.includes('compressed') ||
    mimeType.includes('archive') ||
    mimeType.includes('tar') ||
    mimeType.includes('rar') ||
    mimeType.includes('7z')
  )
    return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

/**
 * Read a browser File object as base64 string (without the data URL prefix).
 */
function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// 鈹€鈹€ Component 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export function ChatInput({
  onSend,
  onStop,
  onToggleThinking,
  resetKey,
  modelOptions = [],
  selectedModel,
  defaultModelValue,
  defaultModelShortLabel,
  onModelChange,
  onConfigureModels,
  modelDisabled = false,
  disabled = false,
  sending = false,
  isEmpty = false,
  showThinking = false,
}: ChatInputProps) {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const isComposingRef = useRef(false);
  const [modelMenuPosition, setModelMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    compact: boolean;
    maxHeight: number;
  } | null>(null);
  const hasModelOptions = modelOptions.length > 0;
  const currentModelValue = selectedModel || defaultModelValue;
  const selectedOption = modelOptions.find((option) => option.value === currentModelValue);
  const currentModelShortLabel =
    selectedOption?.shortLabel || defaultModelShortLabel || t('composer.defaultModel');

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Focus textarea on mount (avoids Windows focus loss after session delete + native dialog)
  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  useEffect(() => {
    setInput('');
    setAttachments([]);
    setModelMenuOpen(false);
    setDragOver(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [resetKey]);

  useEffect(() => {
    if (!modelMenuOpen) return;

    const updatePosition = () => {
      const rect = modelTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const compact = window.innerWidth < 640;
      setModelMenuPosition({
        top: compact ? rect.top : rect.top - 8,
        left: compact ? rect.left : rect.right,
        width: rect.width,
        compact,
        maxHeight: compact ? Math.max(220, window.innerHeight - rect.top - 16) : Math.max(180, rect.top - 16),
      });
    };

    updatePosition();

    const handlePointerDown = (event: MouseEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModelMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [modelMenuOpen]);

  // 鈹€鈹€ File staging via native dialog 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  const pickFiles = useCallback(async () => {
    try {
      const result = (await invokeIpc('dialog:open', {
        properties: ['openFile', 'multiSelections'],
      })) as { canceled: boolean; filePaths?: string[] };
      if (result.canceled || !result.filePaths?.length) return;

      // Add placeholder entries immediately
      const tempIds: string[] = [];
      for (const filePath of result.filePaths) {
        const tempId = crypto.randomUUID();
        tempIds.push(tempId);
        // Handle both Unix (/) and Windows (\) path separators
        const fileName = filePath.split(/[\\/]/).pop() || 'file';
        setAttachments((prev) => [
          ...prev,
          {
            id: tempId,
            fileName,
            mimeType: '',
            fileSize: 0,
            stagedPath: '',
            preview: null,
            status: 'staging' as const,
          },
        ]);
      }

      // Stage all files via IPC
      console.log('[pickFiles] Staging files:', result.filePaths);
      const staged = await hostApiFetch<
        Array<{
          id: string;
          fileName: string;
          mimeType: string;
          fileSize: number;
          stagedPath: string;
          preview: string | null;
        }>
      >('/api/files/stage-paths', {
        method: 'POST',
        body: JSON.stringify({ filePaths: result.filePaths }),
      });
      console.log(
        '[pickFiles] Stage result:',
        staged?.map((s) => ({
          id: s?.id,
          fileName: s?.fileName,
          mimeType: s?.mimeType,
          fileSize: s?.fileSize,
          stagedPath: s?.stagedPath,
          hasPreview: !!s?.preview,
        }))
      );

      // Update each placeholder with real data
      setAttachments((prev) => {
        let updated = [...prev];
        for (let i = 0; i < tempIds.length; i++) {
          const tempId = tempIds[i];
          const data = staged[i];
          if (data) {
            updated = updated.map((a) =>
              a.id === tempId ? { ...data, status: 'ready' as const } : a
            );
          } else {
            console.warn(`[pickFiles] No staged data for tempId=${tempId} at index ${i}`);
            updated = updated.map((a) =>
              a.id === tempId ? { ...a, status: 'error' as const, error: 'Staging failed' } : a
            );
          }
        }
        return updated;
      });
    } catch (err) {
      console.error('[pickFiles] Failed to stage files:', err);
      // Mark any stuck 'staging' attachments as 'error' so the user can remove them
      // and the send button isn't permanently blocked
      setAttachments((prev) =>
        prev.map((a) =>
          a.status === 'staging' ? { ...a, status: 'error' as const, error: String(err) } : a
        )
      );
    }
  }, []);

  // 鈹€鈹€ Stage browser File objects (paste / drag-drop) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    for (const file of files) {
      const tempId = crypto.randomUUID();
      setAttachments((prev) => [
        ...prev,
        {
          id: tempId,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          stagedPath: '',
          preview: null,
          status: 'staging' as const,
        },
      ]);

      try {
        console.log(`[stageBuffer] Reading file: ${file.name} (${file.type}, ${file.size} bytes)`);
        const base64 = await readFileAsBase64(file);
        console.log(`[stageBuffer] Base64 length: ${base64?.length ?? 'null'}`);
        const staged = await hostApiFetch<{
          id: string;
          fileName: string;
          mimeType: string;
          fileSize: number;
          stagedPath: string;
          preview: string | null;
        }>('/api/files/stage-buffer', {
          method: 'POST',
          body: JSON.stringify({
            base64,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
          }),
        });
        console.log(
          `[stageBuffer] Staged: id=${staged?.id}, path=${staged?.stagedPath}, size=${staged?.fileSize}`
        );
        setAttachments((prev) =>
          prev.map((a) => (a.id === tempId ? { ...staged, status: 'ready' as const } : a))
        );
      } catch (err) {
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === tempId ? { ...a, status: 'error' as const, error: String(err) } : a
          )
        );
      }
    }
  }, []);

  // 鈹€鈹€ Attachment management 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const allReady = attachments.length === 0 || attachments.every((a) => a.status === 'ready');
  const hasFailedAttachments = attachments.some((a) => a.status === 'error');
  const canSend = (input.trim() || attachments.length > 0) && allReady && !disabled && !sending;
  const canStop = sending && !disabled && !!onStop;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const readyAttachments = attachments.filter((a) => a.status === 'ready');
    // Capture values before clearing 鈥?clear input immediately for snappy UX,
    // but keep attachments available for the async send
    const textToSend = input.trim();
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;
    console.log(
      `[handleSend] text="${textToSend.substring(0, 50)}", attachments=${attachments.length}, ready=${readyAttachments.length}, sending=${!!attachmentsToSend}`
    );
    if (attachmentsToSend) {
      console.log(
        '[handleSend] Attachment details:',
        attachmentsToSend.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSize: a.fileSize,
          stagedPath: a.stagedPath,
          status: a.status,
          hasPreview: !!a.preview,
        }))
      );
    }
    setInput('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSend(textToSend, attachmentsToSend);
  }, [input, attachments, canSend, onSend]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Handle paste (Ctrl/Cmd+V with files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: globalThis.File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        stageBufferFiles(pastedFiles);
      }
    },
    [stageBufferFiles]
  );

  // Handle drag & drop
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) {
        stageBufferFiles(Array.from(e.dataTransfer.files));
      }
    },
    [stageBufferFiles]
  );

  return (
    <div
      className={cn(
        'mx-auto w-full p-4 pb-4 transition-all duration-300',
        isEmpty ? 'max-w-[920px]' : 'max-w-4xl'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full">
        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2.5">
            {attachments.map((att) => (
              <AttachmentPreview
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {/* Input Row */}
        <div
          className={cn(
            'relative overflow-hidden border backdrop-blur-xl transition-all',
            isEmpty
              ? 'rounded-[16px] p-2 shadow-[0_8px_22px_rgba(15,23,42,0.045)]'
              : 'rounded-[16px] p-2 shadow-[0_18px_45px_rgba(15,23,42,0.08)]',
            dragOver
              ? 'border-sky-500/40 bg-sky-50 ring-2 ring-sky-500/15 dark:bg-sky-400/[0.08]'
              : 'border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.04)_100%)]'
          )}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/20" />
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onPaste={handlePaste}
              placeholder={disabled ? t('composer.gatewayNotConnected') : isEmpty ? t('composer.emptyPlaceholder') : ''}
              disabled={disabled}
              className={cn(
                'resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
                isEmpty
                  ? 'min-h-[72px] max-h-[148px] px-4 py-2.5 text-[16px] leading-7 placeholder:text-muted-foreground/42'
                  : 'min-h-[44px] max-h-[200px] px-2 py-3 text-[15px] leading-7 placeholder:text-muted-foreground/55'
              )}
              rows={1}
            />
          </div>
          <div className="flex flex-col gap-2 px-1 pt-1.5 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'shrink-0 rounded-[14px] text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                isEmpty ? 'h-10 w-10' : 'h-11 w-11'
              )}
              onClick={pickFiles}
              disabled={disabled || sending}
              title={t('composer.attachFiles')}
            >
              <Paperclip className="h-4 w-4" />
            </Button>

            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
              {hasModelOptions ? (
                <div className="relative" ref={modelMenuRef}>
                  <Button
                    ref={modelTriggerRef}
                    type="button"
                    variant="ghost"
                    className={cn(
                      'w-full border border-black/10 bg-white/70 px-3 text-[13px] font-medium text-foreground shadow-none hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.05] dark:hover:bg-white/10 sm:w-auto',
                      isEmpty ? 'h-10 min-w-[112px] rounded-[14px] sm:min-w-[124px]' : 'h-11 min-w-[120px] rounded-[14px] sm:min-w-[132px]'
                    )}
                    disabled={sending || modelDisabled}
                    onClick={() => setModelMenuOpen((open) => !open)}
                  >
                    <span className="truncate">{currentModelShortLabel}</span>
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Button>
                </div>
              ) : onConfigureModels ? (
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    'w-full border border-black/10 bg-white/70 px-3 text-[13px] font-medium text-foreground shadow-none hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.05] dark:hover:bg-white/10 sm:w-auto',
                    isEmpty ? 'h-10 rounded-[14px]' : 'h-11 rounded-[14px]'
                  )}
                  onClick={onConfigureModels}
                >
                  {t('composer.configureModels')}
                </Button>
              ) : null}
              {onToggleThinking ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'rounded-[14px] text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                    showThinking && 'bg-primary/10 text-primary',
                    isEmpty ? 'h-10 w-10' : 'h-11 w-11'
                  )}
                  onClick={onToggleThinking}
                  title={showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}
                >
                  <Brain className="h-4 w-4" />
                </Button>
              ) : null}
              <Button
                onClick={sending ? handleStop : handleSend}
                disabled={sending ? !canStop : !canSend}
                size="icon"
                className={cn(
                  'shrink-0 self-end rounded-[14px] transition-colors',
                  isEmpty ? 'h-10 w-10' : 'h-11 w-11',
                  sending || canSend
                    ? 'bg-[linear-gradient(135deg,#2563eb_0%,#3b82f6_100%)] text-white shadow-[0_10px_25px_rgba(37,99,235,0.28)] hover:opacity-95 dark:bg-[linear-gradient(135deg,#2563eb_0%,#60a5fa_100%)]'
                    : 'bg-transparent text-muted-foreground/50 hover:bg-transparent'
                )}
                variant="ghost"
                title={sending ? t('composer.stop') : t('composer.send')}
              >
                {sending ? (
                  <Square className="h-4 w-4" fill="currentColor" />
                ) : (
                  <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
                )}
              </Button>
            </div>
          </div>
        </div>
        {hasFailedAttachments && (
          <div className="mt-2 flex items-center justify-end gap-2 px-2">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-[11px]"
              onClick={() => {
                setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
                void pickFiles();
              }}
            >
              {t('composer.retryFailedAttachments')}
            </Button>
          </div>
        )}
        {modelMenuOpen && modelMenuPosition
          ? createPortal(
              <div
                ref={modelMenuRef}
                className="fixed z-[120] overflow-hidden rounded-[12px] border border-black/10 bg-card/95 p-1 shadow-lg dark:border-white/10 dark:bg-card/95"
                style={{
                  top: modelMenuPosition.compact ? modelMenuPosition.top : undefined,
                  bottom: modelMenuPosition.compact ? undefined : window.innerHeight - modelMenuPosition.top,
                  left: modelMenuPosition.left,
                  width: modelMenuPosition.compact
                    ? Math.min(Math.max(modelMenuPosition.width, 220), window.innerWidth - 32)
                    : Math.min(320, window.innerWidth - 32),
                  maxHeight: modelMenuPosition.maxHeight,
                  transform: modelMenuPosition.compact ? 'none' : 'translateX(-100%)',
                }}
              >
                <div className="max-h-[inherit] overflow-y-auto">
                  {modelOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[13px] text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                      onClick={() => {
                        setModelMenuOpen(false);
                        void onModelChange?.(
                          selectedModel && defaultModelValue && option.value === defaultModelValue
                            ? undefined
                            : option.value
                        );
                      }}
                    >
                      <span className="flex-1 truncate">{option.label}</span>
                      {currentModelValue === option.value ? (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>,
              document.body
            )
          : null}
      </div>
    </div>
  );
}

// 鈹€鈹€ Attachment Preview 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;

  return (
    <div className="group relative overflow-hidden rounded-[14px] border border-slate-200/80 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.05]">
      {isImage ? (
        // Image thumbnail
        <div className="relative h-16 w-16">
          <img
            src={attachment.preview!}
            alt={attachment.fileName}
            className="w-full h-full object-cover"
          />
          <button
            onClick={onRemove}
            aria-label="Remove attachment"
            className="absolute bottom-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-[10px] border border-transparent bg-white/92 text-muted-foreground transition-colors hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive dark:bg-black/60"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        // Generic file card
        <div className="flex max-w-[248px] items-center gap-2.5 bg-white px-3.5 py-2.5 dark:bg-transparent">
          <FileIcon
            mimeType={attachment.mimeType}
            className="h-5 w-5 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 overflow-hidden">
            <p className="text-xs font-medium truncate">{attachment.fileName}</p>
            <p className="text-[10px] text-muted-foreground">
              {attachment.fileSize > 0 ? formatFileSize(attachment.fileSize) : '...'}
            </p>
          </div>
          <button
            onClick={onRemove}
            aria-label="Remove attachment"
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-transparent bg-white/92 text-muted-foreground transition-colors hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive dark:bg-black/60"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Staging overlay */}
      {attachment.status === 'staging' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <LoadingIcon className="h-4 w-4 text-white" />
        </div>
      )}

      {/* Error overlay */}
      {attachment.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/20">
          <span className="text-[10px] text-destructive font-medium px-1">!</span>
        </div>
      )}
    </div>
  );
}
