import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChat } from '../../stores/chat';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';
import { renderMarkdown } from './markdown';
import { ApprovalCard } from './ApprovalCard';
import { Composer } from './Composer';

export default function ChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    conversations, currentId, messages, hasMore, loading, active,
    init, select, loadOlder, send, stop, removeConversation,
  } = useChat();
  const [readiness, setReadiness] = useState<{ defaultConfigured: boolean } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void init(); }, [init]);
  useEffect(() => { void api.readiness().then(r => setReadiness(r)).catch(() => null); }, [currentId, active?.status]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, active?.streaming, active?.pending.length]);

  const busy = Boolean(active && active.id && active.status !== 'waiting_for_approval');
  const waiting = active?.status === 'waiting_for_approval';

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border/60 md:flex">
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">{t('chat.noConversations')}</p>}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => void select(c.id)}
              className={`group mb-1 w-full truncate rounded-lg px-3 py-2 text-left text-sm ${c.id === currentId ? 'bg-accent' : 'hover:bg-accent/60'}`}
              title={c.title}
            >
              <span className="block truncate">{c.title || c.lastMessagePreview}</span>
              <span className="block flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="truncate">{c.lastMessagePreview}</span>
                <span
                  role="button"
                  className="ml-2 hidden shrink-0 text-red-500 group-hover:inline"
                  onClick={(e) => { e.stopPropagation(); void removeConversation(c.id); }}
                >
                  ✕
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {!currentId && messages.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
            <div className="max-w-sm space-y-3">
              <p className="text-base font-medium">{t('app.title')}</p>
              <p className="text-sm text-muted-foreground">{readiness && !readiness.defaultConfigured ? t('chat.startPrompt') : ''}</p>
              {readiness && !readiness.defaultConfigured && (
                <button onClick={() => navigate('/models')} className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground">
                  {t('chat.configureProvider')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {hasMore && (
              <button onClick={() => void loadOlder()} className="mx-auto mb-3 block text-xs text-primary hover:underline">
                {t('chat.loadOlder')}
              </button>
            )}
            {loading && <p className="text-xs text-muted-foreground">{t('common.loading')}</p>}
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.filter((m) => m.role !== 'tool').map((m) => (
                <MessageBubble key={m.id} role={m.role} content={m.content} />
              ))}
              {active?.reasoning && (
                <div className="whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-xs italic text-muted-foreground">{active.reasoning}</div>
              )}
              {active?.streaming && <MessageBubble role="assistant" content={active.streaming} streaming />}
              {waiting && active?.pending.map((p) => <ApprovalCard key={p.id} invocation={p} />)}
              {active?.status === 'failed' && <div className="text-sm text-red-600">{t('chat.failed')}</div>}
            </div>
            <div ref={bottomRef} />
          </div>
        )}
        <Composer onSend={(text, ids) => void send(text, ids).catch((e) => toast.error(e.message))} busy={busy} waiting={waiting} onStop={() => void stop()} />
      </section>
    </div>
  );
}

function MessageBubble({ role, content, streaming }: { role: string; content: string; streaming?: boolean }) {
  const mine = role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          mine ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-foreground'
        }`}
      >
        {mine ? content : <div className="prose-chat" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />}
        {streaming && <span className="ml-1 inline-block h-3 w-1 animate-pulse rounded bg-current align-middle" />}
      </div>
    </div>
  );
}
