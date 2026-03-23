/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Component, useEffect, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Models } from './pages/Models';
import { Chat } from './pages/Chat';
import { Agents } from './pages/Agents';
import { Channels } from './pages/Channels';
import { Skills } from './pages/Skills';
import { Cron } from './pages/Cron';
import { Settings } from './pages/Settings';
import { Security } from './pages/Security';
import { Setup } from './pages/Setup';
import { useSettingsStore } from './stores/settings';
import { useGatewayStore } from './stores/gateway';
import { useChatStore } from './stores/chat';
import { applyGatewayTransportPreference } from './lib/api-client';
import { GatewayLifecycleOverlay } from './components/common/GatewayLifecycleOverlay';


/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          color: '#f87171',
          background: '#0f172a',
          minHeight: '100vh',
          fontFamily: 'monospace'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Something went wrong</h1>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: '#1e293b',
            padding: '16px',
            borderRadius: '8px',
            fontSize: '14px'
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const initSettings = useSettingsStore((state) => state.init);
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
  const settingsInitialized = useSettingsStore((state) => state.initialized);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const initGateway = useGatewayStore((state) => state.init);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const gatewayLifecycle = useGatewayStore((state) => state.lifecycle);
  const gatewayOverlaySuppressed = useGatewayStore((state) => state.overlaySuppressed);
  const sessionsHydrated = useChatStore((state) => state.sessionsHydrated);
  const restoreSessionsAfterGatewayReady = useChatStore((state) => state.restoreSessionsAfterGatewayReady);
  const lastRestoredLifecycleAtRef = useRef<number | null>(null);
  const suppressGlobalGatewayLifecycle = location.pathname.startsWith('/setup');

  useEffect(() => {
    initSettings();
  }, [initSettings]);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    initGateway();
  }, [initGateway]);

  useEffect(() => {
    if (gatewayStatus.state !== 'running' || sessionsHydrated) return;
    void restoreSessionsAfterGatewayReady();
  }, [gatewayStatus.state, restoreSessionsAfterGatewayReady, sessionsHydrated]);

  useEffect(() => {
    if (gatewayStatus.state !== 'running' || gatewayLifecycle.state !== 'completed') return;
    const completedAt = gatewayLifecycle.at ?? Date.now();
    if (lastRestoredLifecycleAtRef.current === completedAt) return;
    lastRestoredLifecycleAtRef.current = completedAt;
    void restoreSessionsAfterGatewayReady();
  }, [
    gatewayLifecycle.at,
    gatewayLifecycle.state,
    gatewayStatus.state,
    restoreSessionsAfterGatewayReady,
  ]);

  // Redirect to setup wizard if not complete
  useEffect(() => {
    const allowSetupModelFlow = location.pathname === '/models' && location.search.includes('fromSetup=1');
    if (settingsInitialized && !setupComplete && !location.pathname.startsWith('/setup') && !allowSetupModelFlow) {
      navigate('/setup');
    }
  }, [settingsInitialized, setupComplete, location.pathname, location.search, navigate]);

  // Listen for navigation events from main process
  useEffect(() => {
    const handleNavigate = (...args: unknown[]) => {
      const target = args[0];
      if (typeof target === 'string') {
        navigate(target);
        return;
      }
      if (
        target
        && typeof target === 'object'
        && 'path' in target
        && typeof (target as { path?: unknown }).path === 'string'
      ) {
        const payload = target as { path: string; state?: unknown };
        navigate(payload.path, payload.state === undefined ? undefined : { state: payload.state });
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on('navigate', handleNavigate);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  // Apply theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    applyGatewayTransportPreference();
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Routes>
          {/* Setup wizard (shown on first launch) */}
          <Route path="/setup/*" element={<Setup />} />

          {/* Main application routes */}
          <Route element={<MainLayout />}>
            <Route path="/" element={<Chat />} />
            <Route path="/models" element={<Models />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/cron" element={<Cron />} />
            <Route path="/security" element={<Security />} />
            <Route path="/settings/*" element={<Settings />} />
          </Route>
        </Routes>

        {!suppressGlobalGatewayLifecycle && !gatewayOverlaySuppressed && (
          <GatewayLifecycleOverlay lifecycle={gatewayLifecycle} />
        )}

        {/* Global toast notifications */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          style={{ zIndex: 99999 }}
        />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
