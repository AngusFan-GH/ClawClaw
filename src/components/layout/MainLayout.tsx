/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function MainLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="flex flex-1 overflow-hidden gap-3 p-3">
        <Sidebar />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/88 p-6 shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
