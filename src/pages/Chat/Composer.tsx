import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import type { Artifact } from '../../lib/types';

interface Props {
  onSend: (text: string, attachments: string[]) => void;
  busy: boolean;
  waiting?: boolean;
  onStop: () => void;
}

export function Composer({ onSend, busy, waiting, onStop }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Artifact[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const stageFiles = async (paths: string[]) => {
    try {
      const staged = await api.stagePaths(paths);
      setFiles((f) => [...f, ...staged]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'failed');
    }
  };

  const pick = async () => {
    try {
      const result = (await window.desktop.ipcRenderer.invoke('dialog:open', {
        title: t('chat.addAttachment'),
        properties: ['openFile', 'multiSelections'],
      })) as { filePaths?: string[] } | null;
      if (result?.filePaths?.length) await stageFiles(result.filePaths);
    } catch {
      /* dialog cancelled */
    }
  };

  const stageDataTransfer = async (dataTransfer: DataTransfer | null) => {
    if (!dataTransfer?.files?.length) return;
    const staged: Artifact[] = [];
    for (const file of Array.from(dataTransfer.files)) {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      staged.push(await api.stageBuffer(base64, file.name, file.type || undefined));
    }
    setFiles((f) => [...f, ...staged]);
  };

  const submit = () => {
    const value = text.trim();
    if ((!value && !files.length) || (busy && !waiting)) return;
    onSend(value, files.map((f) => f.id));
    setText('');
    setFiles([]);
  };

  return (
    <div className="shrink-0 border-t border-border/60 p-3" onPaste={(e) => void stageDataTransfer(e.clipboardData)} onDrop={(e) => { e.preventDefault(); void stageDataTransfer(e.dataTransfer); }} onDragOver={(e) => e.preventDefault()}>
      {files.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
          {files.map((f) => (
            <span key={f.id} className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs">
              {f.displayName}
              <button onClick={() => setFiles((all) => all.filter((x) => x.id !== f.id))} className="text-muted-foreground hover:text-red-500">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <button onClick={() => void pick()} title={t('chat.addAttachment')} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border hover:bg-accent">📎</button>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={t('chat.placeholder')}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
        />
        {busy ? (
          <button onClick={onStop} className="shrink-0 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white">{t('common.stop')}</button>
        ) : (
          <button onClick={submit} className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">{t('common.send')}</button>
        )}
      </div>
    </div>
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
