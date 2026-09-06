import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { useChat } from '../stores/chat';

const NAV = [
  { to: '/', icon: '💬', key: 'chat' },
  { to: '/models', icon: '🧩', key: 'models' },
  { to: '/agents', icon: '🤖', key: 'agents' },
  { to: '/skills', icon: '📚', key: 'skills' },
  { to: '/channels', icon: '🔌', key: 'channels' },
  { to: '/cron', icon: '⏰', key: 'cron' },
  { to: '/settings', icon: '⚙️', key: 'settings' },
] as const;

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const init = useChat((s) => s.init);
  const newChat = useChat((s) => s.newChat);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    void api.readiness().catch(() => null);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="drag-region flex h-9 shrink-0 items-center justify-between border-b border-border/60 pl-3">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground">{t('app.title')} · ClawCore</span>
        <div className="no-drag flex items-center gap-1 pr-2">
          <WindowButton label="–" onClick={() => void getCurrentWindow().minimize()} />
          <WindowButton label="□" onClick={() => void getCurrentWindow().toggleMaximize()} />
          <WindowButton label="✕" danger onClick={() => void getCurrentWindow().close()} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border/60 py-3 md:w-52 md:items-stretch md:px-2">
          <button
            onClick={() => {
              newChat();
              navigate('/');
            }}
            className="mx-2 mb-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            + {t('chat.newChat')}
          </button>
          {NAV.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                  isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              <span className="hidden md:inline">{t(`nav.${item.key}`)}</span>
            </NavLink>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function WindowButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`grid h-6 w-8 place-items-center rounded text-xs ${danger ? 'hover:bg-red-500 hover:text-white' : 'hover:bg-accent'}`}
    >
      {label}
    </button>
  );
}
