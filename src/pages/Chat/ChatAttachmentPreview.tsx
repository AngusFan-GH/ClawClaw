import { Trash2, FileText, Film, Music, FileArchive, File } from 'lucide-react';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
import type { FileAttachment } from './ChatInput';

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
    mimeType.startsWith('text/')
    || mimeType === 'application/json'
    || mimeType === 'application/xml'
  ) {
    return <FileText className={className} />;
  }
  if (
    mimeType.includes('zip')
    || mimeType.includes('compressed')
    || mimeType.includes('archive')
    || mimeType.includes('tar')
    || mimeType.includes('rar')
    || mimeType.includes('7z')
  ) {
    return <FileArchive className={className} />;
  }
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

export function ChatAttachmentPreview({
  attachment,
  onRemove,
  removeAriaLabel,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
  removeAriaLabel: string;
}) {
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;
  const imageRemoveButtonClass =
    'absolute left-1/2 top-1/2 z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-slate-600 shadow-sm backdrop-blur-sm opacity-0 transition-all hover:bg-destructive/12 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 dark:bg-black/65 dark:text-slate-200 dark:hover:bg-destructive/18';
  const fileRemoveButtonClass =
    'absolute right-1.5 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-slate-600 shadow-sm backdrop-blur-sm opacity-0 transition-all hover:bg-destructive/12 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 dark:bg-black/65 dark:text-slate-200 dark:hover:bg-destructive/18';

  return (
    <div className="group relative overflow-hidden rounded-[14px] border border-slate-200/80 bg-white shadow-[0_8px_18px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.04]">
      {isImage ? (
        <div className="relative h-16 w-16">
          <img
            src={attachment.preview!}
            alt={attachment.fileName}
            className="h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeAriaLabel}
            className={imageRemoveButtonClass}
          >
            <Trash2 className="h-3.25 w-3.25" />
          </button>
        </div>
      ) : (
        <div className="relative flex min-w-[156px] max-w-[220px] items-center gap-3 px-3 py-2.5 pr-10">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-slate-100 text-slate-500 dark:bg-white/8 dark:text-slate-300">
            <FileIcon
              mimeType={attachment.mimeType}
              className="h-[18px] w-[18px] shrink-0"
            />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-slate-900 dark:text-slate-100">
              {attachment.fileName}
            </p>
            <p className="mt-0.5 text-[11px] leading-none text-muted-foreground">
              {attachment.fileSize > 0 ? formatFileSize(attachment.fileSize) : '...'}
            </p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeAriaLabel}
            className={fileRemoveButtonClass}
          >
            <Trash2 className="h-3.25 w-3.25" />
          </button>
        </div>
      )}

      {attachment.status === 'staging' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <LoadingIcon className="h-4 w-4 text-white" />
        </div>
      )}

      {attachment.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/20">
          <span className="px-1 text-[10px] font-medium text-destructive">!</span>
        </div>
      )}
    </div>
  );
}
