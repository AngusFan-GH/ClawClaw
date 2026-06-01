/**
 * Chat Input Component
 * Textarea with send button and universal file upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged to disk via IPC 鈥?only lightweight path references
 * are sent with the message (no base64 over WebSocket).
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  SendHorizontal,
  Square,
  Paperclip,
  ChevronsUpDown,
  LoaderCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import { Brain } from 'lucide-react';
import { ChatAttachmentPreview } from './ChatAttachmentPreview';
import { ChatModelMenu } from './ChatModelMenu';
import { ChatSlashMenu } from './ChatSlashMenu';
import { DEFAULT_THINKING_LEVELS, normalizeThinkingLevel } from './thinking-levels';
import {
  CATEGORY_I18N_KEYS,
  CATEGORY_LABELS,
  getSlashArgumentCompletions,
  getSlashCommandCompletions,
  parseSlashCommand,
  type SlashCommandDef,
} from './slash-commands';

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
  modelState?: 'disabled' | 'ready' | 'syncing' | 'invalid' | 'unconfigured';
  thinkingLevel?: string | null;
  thinkingOptions?: string[];
  thinkingDefault?: string | null;
  onThinkingLevelChange?: (level?: string) => void | Promise<void>;
  thinkingDisabled?: boolean;
  disabled?: boolean;
  sending?: boolean;
  isEmpty?: boolean;
  showThinking?: boolean;
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

const INPUT_HISTORY_LIMIT = 50;
const selectorTriggerClass =
  'group w-full justify-between gap-2 border border-black/10 bg-gradient-to-b from-white/95 to-white/70 px-3 text-[13px] font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-px hover:border-black/15 hover:bg-white hover:shadow-[0_8px_22px_rgba(15,23,42,0.10)] focus-visible:ring-2 focus-visible:ring-primary/25 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55 dark:border-white/10 dark:from-white/[0.09] dark:to-white/[0.04] dark:hover:border-white/15 dark:hover:bg-white/[0.10] sm:w-auto';
const selectorTriggerSizeClass = (isEmpty: boolean) =>
  isEmpty ? 'h-10 min-w-[128px] rounded-[16px]' : 'h-11 min-w-[136px] rounded-[16px]';

function formatThinkingLevelLabel(
  t: ReturnType<typeof useTranslation>['t'],
  level: string,
): string {
  const normalized = level.trim();
  if (!normalized) return normalized;
  return t(`composer.thinkingLevels.${normalized}`, {
    defaultValue: normalized,
  });
}

class InputHistory {
  private items: string[] = [];
  private cursor = -1;

  push(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.items[this.items.length - 1] === trimmed) return;
    this.items.push(trimmed);
    if (this.items.length > INPUT_HISTORY_LIMIT) this.items.shift();
    this.cursor = -1;
  }

  up(): string | null {
    if (this.items.length === 0) return null;
    if (this.cursor < 0) this.cursor = this.items.length - 1;
    else if (this.cursor > 0) this.cursor -= 1;
    return this.items[this.cursor] ?? null;
  }

  down(): string | null {
    if (this.cursor < 0) return null;
    this.cursor += 1;
    if (this.cursor >= this.items.length) {
      this.cursor = -1;
      return null;
    }
    return this.items[this.cursor] ?? null;
  }

  reset(): void {
    this.cursor = -1;
  }
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
  modelState = 'ready',
  thinkingLevel,
  thinkingOptions = [],
  thinkingDefault,
  onThinkingLevelChange,
  thinkingDisabled = false,
  disabled = false,
  sending = false,
  isEmpty = false,
  showThinking = false,
}: ChatInputProps) {
  const { t } = useTranslation('chat');
  const slashCommandHintsEnabled = useSettingsStore((state) => state.slashCommandHintsEnabled);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const isComposingRef = useRef(false);
  const commandMenuRef = useRef<HTMLDivElement>(null);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const inputHistoryRef = useRef(new InputHistory());
  const thinkingMenuRef = useRef<HTMLDivElement>(null);
  const thinkingTriggerRef = useRef<HTMLButtonElement>(null);
  const [modelMenuPosition, setModelMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    compact: boolean;
    maxHeight: number;
  } | null>(null);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [thinkingMenuPosition, setThinkingMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    compact: boolean;
    maxHeight: number;
  } | null>(null);
  const hasModelOptions = modelOptions.length > 0;
  const currentThinkingLevel = thinkingLevel?.trim() || '';
  const normalizedThinkingOptions = useMemo(() => {
    const fallback = ['', ...DEFAULT_THINKING_LEVELS];
    const source = thinkingOptions.length > 0 ? thinkingOptions : fallback;
    const seen = new Set<string>();
    return [...source, currentThinkingLevel]
      .map((option) => normalizeThinkingLevel(option) ?? option.trim())
      .filter((option) => {
        if (seen.has(option)) return false;
        seen.add(option);
        return true;
      });
  }, [currentThinkingLevel, thinkingOptions]);
  const canChangeThinkingLevel = Boolean(onThinkingLevelChange) && normalizedThinkingOptions.length > 0;
  const thinkingDefaultLabel = thinkingDefault?.trim() || 'off';
  const localizedThinkingDefaultLabel = formatThinkingLevelLabel(t, thinkingDefaultLabel);
  const thinkingMenuOptions = useMemo(
    () => normalizedThinkingOptions.map((option) => ({
      value: option,
      label: option
        ? formatThinkingLevelLabel(t, option)
        : t('composer.defaultThinkingLevel', 'Default ({{level}})', {
            level: localizedThinkingDefaultLabel,
          }),
    })),
    [normalizedThinkingOptions, t, localizedThinkingDefaultLabel]
  );
  const effectiveThinkingLevel = normalizeThinkingLevel(currentThinkingLevel) ?? currentThinkingLevel;
  const thinkingButtonLabel =
    effectiveThinkingLevel
      ? formatThinkingLevelLabel(t, effectiveThinkingLevel)
      : t('composer.defaultThinkingLevel', 'Default ({{level}})', {
          level: localizedThinkingDefaultLabel,
        });
  const currentModelValue = selectedModel || defaultModelValue;
  const selectedOption = modelOptions.find((option) => option.value === currentModelValue);
  const currentModelShortLabel =
    selectedOption?.shortLabel || defaultModelShortLabel || t('composer.defaultModel');
  const showModelPicker = hasModelOptions && modelState !== 'syncing';
  const showConfigureModels = !showModelPicker && modelState !== 'syncing' && !!onConfigureModels;
  const hasResolvedCurrentModel = Boolean(selectedOption);
  const modelButtonLabel = modelState === 'syncing'
    ? t('composer.modelsSyncing')
    : hasResolvedCurrentModel
      ? currentModelShortLabel
    : modelState === 'unconfigured' || modelState === 'invalid'
      ? t('composer.configureModels')
      : currentModelShortLabel;
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuMode, setSlashMenuMode] = useState<'command' | 'args'>('command');
  const [slashMenuItems, setSlashMenuItems] = useState<SlashCommandDef[]>([]);
  const [slashArgCommand, setSlashArgCommand] = useState<SlashCommandDef | null>(null);
  const [slashArgItems, setSlashArgItems] = useState<string[]>([]);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);

  const resetSlashMenu = useCallback(() => {
    setSlashMenuOpen(false);
    setSlashMenuMode('command');
    setSlashMenuItems([]);
    setSlashArgCommand(null);
    setSlashArgItems([]);
    setSlashMenuIndex(0);
  }, []);

  const updateSlashMenu = useCallback((value: string) => {
    if (!slashCommandHintsEnabled) {
      resetSlashMenu();
      return;
    }

    const raw = value.trimStart();
    if (!raw.startsWith('/')) {
      resetSlashMenu();
      return;
    }

    const argMenu = getSlashArgumentCompletions(raw);
    if (argMenu) {
      setSlashMenuMode('args');
      setSlashArgCommand(argMenu.command);
      setSlashArgItems(argMenu.options);
      setSlashMenuItems([]);
      setSlashMenuIndex(0);
      setSlashMenuOpen(true);
      return;
    }

    const match = raw.match(/^\/([^\s:]*)$/u);
    if (match) {
      const items = getSlashCommandCompletions(match[1] ?? '');
      setSlashMenuMode('command');
      setSlashMenuItems(items);
      setSlashArgCommand(null);
      setSlashArgItems([]);
      setSlashMenuIndex(0);
      setSlashMenuOpen(items.length > 0);
      return;
    }

    resetSlashMenu();
  }, [resetSlashMenu, slashCommandHintsEnabled]);

  const applySlashCommand = useCallback((command: SlashCommandDef) => {
    const nextValue = command.acceptsArgs ? `/${command.name} ` : `/${command.name}`;
    setInput(nextValue);
    queueMicrotask(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        const caret = nextValue.length;
        textareaRef.current.setSelectionRange(caret, caret);
      }
    });

    if (command.argOptions?.length) {
      setSlashMenuMode('args');
      setSlashArgCommand(command);
      setSlashArgItems(command.argOptions);
      setSlashMenuItems([]);
      setSlashMenuIndex(0);
      setSlashMenuOpen(true);
      return;
    }

    resetSlashMenu();
  }, [resetSlashMenu]);

  const applySlashArg = useCallback((arg: string) => {
    const command = slashArgCommand;
    if (!command) return;
    const nextValue = `/${command.name} ${arg}`;
    setInput(nextValue);
    queueMicrotask(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        const caret = nextValue.length;
        textareaRef.current.setSelectionRange(caret, caret);
      }
    });
    resetSlashMenu();
  }, [resetSlashMenu, slashArgCommand]);

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
    setThinkingMenuOpen(false);
    setDragOver(false);
    inputHistoryRef.current.reset();
    resetSlashMenu();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [resetKey, resetSlashMenu]);

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

  useEffect(() => {
    if (!thinkingMenuOpen) return;

    const updatePosition = () => {
      const rect = thinkingTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const compact = window.innerWidth < 640;
      setThinkingMenuPosition({
        top: compact ? rect.top : rect.top - 8,
        left: compact ? rect.left : rect.right,
        width: rect.width,
        compact,
        maxHeight: compact ? Math.max(220, window.innerHeight - rect.top - 16) : Math.max(180, rect.top - 16),
      });
    };

    updatePosition();

    const handlePointerDown = (event: MouseEvent) => {
      if (!thinkingMenuRef.current?.contains(event.target as Node)) {
        setThinkingMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setThinkingMenuOpen(false);
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
  }, [thinkingMenuOpen]);

  useEffect(() => {
    if (!slashCommandHintsEnabled) {
      resetSlashMenu();
    }
  }, [resetSlashMenu, slashCommandHintsEnabled]);

  useEffect(() => {
    if (!slashMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !commandMenuRef.current?.contains(target) &&
        !textareaRef.current?.contains(target as Node)
      ) {
        resetSlashMenu();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [resetSlashMenu, slashMenuOpen]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    const target = slashItemRefs.current[slashMenuIndex];
    target?.scrollIntoView({ block: 'nearest' });
  }, [slashMenuIndex, slashMenuOpen, slashMenuItems, slashArgItems]);

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
      if (import.meta.env.DEV) {
        console.debug('[pickFiles] Staging files:', result.filePaths);
      }
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
      if (import.meta.env.DEV) {
        console.debug(
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
      }

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
        if (import.meta.env.DEV) {
          console.debug(`[stageBuffer] Reading file: ${file.name} (${file.type}, ${file.size} bytes)`);
        }
        const base64 = await readFileAsBase64(file);
        if (import.meta.env.DEV) {
          console.debug(`[stageBuffer] Base64 length: ${base64?.length ?? 'null'}`);
        }
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
        if (import.meta.env.DEV) {
          console.debug(
            `[stageBuffer] Staged: id=${staged?.id}, path=${staged?.stagedPath}, size=${staged?.fileSize}`
          );
        }
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
  const trimmedInput = input.trim();
  const parsedSlashCommand = parseSlashCommand(trimmedInput);
  const activeCommand = parsedSlashCommand?.command ?? null;
  const isBtwCommand = activeCommand?.name === 'btw';
  const hasSubmitContent = Boolean(trimmedInput || attachments.length > 0);
  const canSubmit = hasSubmitContent && allReady && !disabled;
  const canQueueWhileSending = canSubmit && sending;
  const canStop = sending && !disabled && !!onStop;

  const handleSend = useCallback(() => {
    if (!canSubmit) return;
    const readyAttachments = attachments.filter((a) => a.status === 'ready');
    // Capture values before clearing 鈥?clear input immediately for snappy UX,
    // but keep attachments available for the async send
    const textToSend = input.trim();
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;
    if (import.meta.env.DEV) {
      console.debug(
        `[handleSend] text="${textToSend.substring(0, 50)}", attachments=${attachments.length}, ready=${readyAttachments.length}, sending=${!!attachmentsToSend}`
      );
    }
    if (attachmentsToSend) {
      if (import.meta.env.DEV) {
        console.debug(
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
    }
    setInput('');
    setAttachments([]);
    resetSlashMenu();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSend(textToSend, attachmentsToSend);
    if (textToSend) {
      inputHistoryRef.current.push(textToSend);
    }
  }, [attachments, canSubmit, input, onSend, resetSlashMenu]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (slashMenuOpen) {
        const items = slashMenuMode === 'args' ? slashArgItems : slashMenuItems;
        if (items.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSlashMenuIndex((current) => (current + 1) % items.length);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSlashMenuIndex((current) => (current - 1 + items.length) % items.length);
            return;
          }
          if (e.key === 'Tab' || e.key === 'Enter') {
            const nativeEvent = e.nativeEvent as KeyboardEvent;
            if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
              return;
            }
            e.preventDefault();
            if (slashMenuMode === 'args') {
              applySlashArg(slashArgItems[slashMenuIndex] || slashArgItems[0]);
            } else {
              const selected = slashMenuItems[slashMenuIndex] || slashMenuItems[0];
              if (selected) {
                applySlashCommand(selected);
              }
            }
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          resetSlashMenu();
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        if (canSubmit) {
          handleSend();
        } else if (canStop) {
          handleStop();
        }
        return;
      }

      if (!input.trim() && e.key === 'ArrowUp') {
        const previous = inputHistoryRef.current.up();
        if (previous !== null) {
          e.preventDefault();
          setInput(previous);
          updateSlashMenu(previous);
        }
        return;
      }

      if (!input.trim() && e.key === 'ArrowDown') {
        const next = inputHistoryRef.current.down();
        e.preventDefault();
        setInput(next ?? '');
        updateSlashMenu(next ?? '');
      }
    },
    [applySlashArg, applySlashCommand, canStop, canSubmit, handleSend, handleStop, input, resetSlashMenu, slashArgItems, slashMenuIndex, slashMenuItems, slashMenuMode, slashMenuOpen, updateSlashMenu]
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

  const groupedSlashCommands = slashMenuItems.reduce<Record<string, SlashCommandDef[]>>((acc, command) => {
    const key = command.category;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(command);
    return acc;
  }, {});

  slashItemRefs.current = [];

  const getLocalizedCommandDescription = useCallback(
    (command: SlashCommandDef) =>
      t(`slash.commands.${command.key}.description`, command.description),
    [t]
  );

  const getLocalizedCategoryLabel = useCallback(
    (category: keyof typeof CATEGORY_LABELS) =>
      t(CATEGORY_I18N_KEYS[category], CATEGORY_LABELS[category]),
    [t]
  );
  const slashMenuLabels = useMemo(
    () => ({
      title: t('slash.title', 'Commands'),
      enterSelect: t('slash.footer.enterSelect', 'Enter select'),
      tabFill: t('slash.footer.tabFill', 'Tab fill'),
      escClose: t('slash.footer.escClose', 'Esc close'),
      navigate: t('slash.footer.navigate', '↑↓ navigate'),
      optionsSuffix: t('slash.optionsSuffix', 'options'),
    }),
    [t]
  );

  const primaryAction = sending && !hasSubmitContent ? 'stop' : 'send';
  const primaryActionTitle =
    primaryAction === 'stop'
      ? t('composer.stop')
      : sending
        ? isBtwCommand
          ? t('composer.sendBtw', '发送旁支问题')
          : t('composer.queueMessage', '加入队列')
        : t('composer.send');
  const commandHelperText = activeCommand
    ? isBtwCommand
      ? t('composer.commandBtwHint', '旁支回答不会写入会话历史，也不会污染后续上下文。')
      : activeCommand.name === 'compact'
        ? t('composer.commandCompactHint', '这会触发一次手动上下文压缩。')
        : activeCommand.name === 'queue'
          ? t('composer.commandQueueHint', '这会修改当前会话在忙碌时的排队策略。')
          : getLocalizedCommandDescription(activeCommand)
    : null;

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
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att) => (
              <ChatAttachmentPreview
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
                removeAriaLabel={t('composer.removeAttachment', '移除附件')}
              />
            ))}
          </div>
        )}

        {/* Input Row */}
        <div
          className={cn(
            'relative border backdrop-blur-xl transition-all',
            slashCommandHintsEnabled && slashMenuOpen ? 'overflow-visible' : 'overflow-hidden',
            isEmpty
              ? 'rounded-[16px] p-2 shadow-[0_8px_22px_rgba(15,23,42,0.045)]'
              : 'rounded-[16px] p-2 shadow-[0_18px_45px_rgba(15,23,42,0.08)]',
            dragOver
              ? 'border-sky-500/40 bg-sky-50 ring-2 ring-sky-500/15 dark:bg-sky-400/[0.08]'
              : 'border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.04)_100%)]'
          )}
        >
          {slashCommandHintsEnabled && slashMenuOpen && (
            <ChatSlashMenu
              menuRef={commandMenuRef}
              mode={slashMenuMode}
              argCommand={slashArgCommand}
              argItems={slashArgItems}
              menuIndex={slashMenuIndex}
              menuItems={slashMenuItems}
              groupedCommands={groupedSlashCommands}
              itemRefs={slashItemRefs}
              onHoverIndex={setSlashMenuIndex}
              onApplyArg={applySlashArg}
              onApplyCommand={applySlashCommand}
              getCommandDescription={getLocalizedCommandDescription}
              getCategoryLabel={(category) =>
                getLocalizedCategoryLabel(category as keyof typeof CATEGORY_LABELS)
              }
              labels={slashMenuLabels}
            />
          )}

          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/20" />
          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                const nextValue = e.target.value;
                setInput(nextValue);
                inputHistoryRef.current.reset();
                updateSlashMenu(nextValue);
              }}
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
          {activeCommand ? (
            <div className="flex flex-wrap items-center gap-2 px-2 pb-1 text-xs">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 font-mono font-semibold text-primary">
                /{activeCommand.name}
              </span>
              <span className="text-muted-foreground">{commandHelperText}</span>
              {canQueueWhileSending && !isBtwCommand ? (
                <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">
                  {t('composer.commandQueuedHint', '发送后将排队，等待当前运行结束')}
                </span>
              ) : null}
              {canQueueWhileSending && isBtwCommand ? (
                <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
                  {t('composer.commandDetachedHint', '会并行发送，不打断当前运行')}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-2 px-1 pt-1.5 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'shrink-0 rounded-[14px] text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                isEmpty ? 'h-10 w-10' : 'h-11 w-11'
              )}
              onClick={pickFiles}
              disabled={disabled}
              title={t('composer.attachFiles')}
            >
              <Paperclip className="h-4 w-4" />
            </Button>

            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
              {showModelPicker ? (
                <div className="relative" ref={modelMenuRef}>
                  <Button
                    ref={modelTriggerRef}
                    type="button"
                    variant="ghost"
                    className={cn(
                      selectorTriggerClass,
                      selectorTriggerSizeClass(isEmpty)
                    )}
                    disabled={sending || modelDisabled}
                    onClick={() => setModelMenuOpen((open) => !open)}
                  >
                    <span className="truncate">{modelButtonLabel}</span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:scale-110" />
                  </Button>
                </div>
              ) : modelState === 'syncing' ? (
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    selectorTriggerClass,
                    selectorTriggerSizeClass(isEmpty)
                  )}
                  disabled
                >
                  <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {modelButtonLabel}
                </Button>
              ) : showConfigureModels ? (
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    selectorTriggerClass,
                    selectorTriggerSizeClass(isEmpty)
                  )}
                  onClick={onConfigureModels}
                >
                  {modelButtonLabel}
                </Button>
              ) : null}
              {canChangeThinkingLevel ? (
                <div className="relative" ref={thinkingMenuRef}>
                  <Button
                    ref={thinkingTriggerRef}
                    type="button"
                    variant="ghost"
                    className={cn(
                      selectorTriggerClass,
                      selectorTriggerSizeClass(isEmpty)
                    )}
                    disabled={sending || thinkingDisabled || disabled}
                    onClick={() => setThinkingMenuOpen((open) => !open)}
                    title={t('composer.thinkingLevelAriaLabel', 'Set thinking level for current conversation')}
                    aria-label={t('composer.thinkingLevelAriaLabel', 'Set thinking level for current conversation')}
                  >
                    <Brain className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                    <span className="truncate">{thinkingButtonLabel}</span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:scale-110" />
                  </Button>
                </div>
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
              {sending && hasSubmitContent && canStop ? (
                <Button
                  onClick={handleStop}
                  size="icon"
                  variant="ghost"
                  className={cn(
                    'shrink-0 self-end rounded-[14px] border border-black/10 bg-white/70 text-foreground shadow-none hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.05] dark:hover:bg-white/10',
                    isEmpty ? 'h-10 w-10' : 'h-11 w-11'
                  )}
                  title={t('composer.stop')}
                >
                  <Square className="h-4 w-4" fill="currentColor" />
                </Button>
              ) : null}
              <Button
                onClick={primaryAction === 'stop' ? handleStop : handleSend}
                disabled={primaryAction === 'stop' ? !canStop : !canSubmit}
                size="icon"
                className={cn(
                  'shrink-0 self-end rounded-[14px] transition-colors',
                  isEmpty ? 'h-10 w-10' : 'h-11 w-11',
                  (primaryAction === 'stop' && canStop) || (primaryAction === 'send' && canSubmit)
                    ? 'bg-[linear-gradient(135deg,#2563eb_0%,#3b82f6_100%)] text-white shadow-[0_10px_25px_rgba(37,99,235,0.28)] hover:opacity-95 dark:bg-[linear-gradient(135deg,#2563eb_0%,#60a5fa_100%)]'
                    : 'bg-transparent text-muted-foreground/50 hover:bg-transparent'
                )}
                variant="ghost"
                title={primaryActionTitle}
              >
                {primaryAction === 'stop' ? (
                  <Square className="h-4 w-4" fill="currentColor" />
                ) : sending ? (
                  <div className="flex flex-col items-center">
                    <SendHorizontal className="h-[14px] w-[14px] opacity-50" strokeWidth={2} />
                    <span className="mt-0.5 text-[9px] font-medium leading-none">{t('composer.queue', 'Queue')}</span>
                  </div>
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
        <ChatModelMenu
          menuRef={modelMenuRef}
          open={modelMenuOpen}
          position={modelMenuPosition}
          options={modelOptions}
          currentValue={currentModelValue}
          onSelect={(value) => {
            setModelMenuOpen(false);
            void onModelChange?.(value);
          }}
        />
        <ChatModelMenu
          menuRef={thinkingMenuRef}
          open={thinkingMenuOpen}
          position={thinkingMenuPosition}
          options={thinkingMenuOptions}
          currentValue={effectiveThinkingLevel}
          minWidth={156}
          maxWidth={220}
          onSelect={(value) => {
            setThinkingMenuOpen(false);
            void onThinkingLevelChange?.(value || undefined);
          }}
        />
      </div>
    </div>
  );
}
