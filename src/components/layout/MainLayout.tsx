/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { Outlet } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { GatewayLifecycleBanner } from '@/components/common/GatewayLifecycleBanner';
import { useGatewayStore } from '@/stores/gateway';

export function MainLayout() {
  const location = useLocation();
  const gatewayLifecycle = useGatewayStore((state) => state.lifecycle);
  const bannerLifecycle =
    location.pathname === '/security'
    && gatewayLifecycle.state === 'completed'
    && (gatewayLifecycle.source === 'security.apply' || gatewayLifecycle.source === 'security.reset')
      ? { state: 'idle' as const }
      : gatewayLifecycle;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="flex flex-1 overflow-hidden gap-3 p-3">
        <Sidebar />
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <GatewayLifecycleBanner lifecycle={bannerLifecycle} />
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/88 p-6 shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
