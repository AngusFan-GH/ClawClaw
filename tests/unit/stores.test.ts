/**
 * Zustand Stores Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';

describe('Settings Store', () => {
  beforeEach(() => {
    // Reset store to default state
    useSettingsStore.setState({
      theme: 'system',
      language: 'en',
      sidebarCollapsed: false,
      devModeUnlocked: false,
      gatewayAutoStart: true,
      gatewayPort: 18789,
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      startMinimized: false,
      launchAtStartup: false,
      updateChannel: 'stable',
    });
  });
  
  it('should have default values', () => {
    const state = useSettingsStore.getState();
    expect(state.theme).toBe('system');
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.gatewayAutoStart).toBe(true);
  });
  
  it('should update theme', () => {
    const { setTheme } = useSettingsStore.getState();
    setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
  });
  
  it('should toggle sidebar collapsed state', () => {
    const { setSidebarCollapsed } = useSettingsStore.getState();
    setSidebarCollapsed(true);
    expect(useSettingsStore.getState().sidebarCollapsed).toBe(true);
  });
  
  it('should unlock dev mode', () => {
    const { setDevModeUnlocked } = useSettingsStore.getState();
    setDevModeUnlocked(true);
    expect(useSettingsStore.getState().devModeUnlocked).toBe(true);
  });
});

describe('Gateway Store', () => {
  beforeEach(() => {
    // Reset store
    useGatewayStore.setState({
      status: { state: 'stopped', port: 18789 },
      isInitialized: false,
    });
  });
  
  it('should have default status', () => {
    const state = useGatewayStore.getState();
    expect(state.status.state).toBe('stopped');
    expect(state.status.port).toBe(18789);
  });
  
  it('should update status', () => {
    const { setStatus } = useGatewayStore.getState();
    setStatus({ state: 'running', port: 18789, pid: 12345 });
    
    const state = useGatewayStore.getState();
    expect(state.status.state).toBe('running');
    expect(state.status.pid).toBe(12345);
  });

  it('should normalize gateway connect errors when updating status', () => {
    const { setStatus } = useGatewayStore.getState();
    setStatus({
      state: 'error',
      port: 18789,
      error: 'fetch failed',
    });

    const state = useGatewayStore.getState();
    expect(state.status.error).toBe('Gateway connection failed');
  });

  it('should proxy gateway rpc through ipc', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({ success: true, result: { ok: true } });

    const result = await useGatewayStore.getState().rpc<{ ok: boolean }>('chat.history', { limit: 10 }, 5000);

    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('gateway:rpc', 'chat.history', { limit: 10 }, 5000);
  });
});

describe('Chat Store', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useChatStore.setState({
      loading: false,
      messages: [],
      currentSessionKey: 'agent:main:main',
      pendingLocalSessionKeys: {},
      sending: false,
      lastUserMessageAt: null,
      error: null,
      pendingFinal: false,
      sessions: [{ key: 'agent:main:main', displayName: 'Main' }],
      sessionLabels: {},
      sessionLastActivity: {},
    });
  });

  it('should clear loading when a stale history request is no longer current', async () => {
    let resolveFirst: ((value: { messages: never[] }) => void) | undefined;
    const rpcMock = vi
      .spyOn(useGatewayStore.getState(), 'rpc')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve as (value: { messages: never[] }) => void;
          }),
      )
      .mockResolvedValueOnce({ messages: [] });

    const firstLoad = useChatStore.getState().loadHistory(false);
    useChatStore.setState({ currentSessionKey: 'agent:main:other' });
    const secondLoad = useChatStore.getState().loadHistory(false);

    resolveFirst?.({ messages: [] });

    await Promise.all([firstLoad, secondLoad]);

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().loading).toBe(false);

    rpcMock.mockRestore();
  });

  it('should start history polling when an external agent run begins on the current session', async () => {
    vi.useFakeTimers();

    const loadHistoryMock = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      loadHistory: loadHistoryMock,
      sessions: [{ key: 'agent:main:main', displayName: 'Main' }],
      currentSessionKey: 'agent:main:main',
      sending: false,
      activeRunId: null,
    });

    useChatStore.getState().handleAgentEvent({
      runId: 'run-ext-1',
      sessionKey: 'agent:main:main',
      stream: 'tool',
      data: {
        phase: 'start',
      },
    });

    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().activeRunId).toBe('run-ext-1');

    await vi.advanceTimersByTimeAsync(3000);

    expect(loadHistoryMock).toHaveBeenCalledWith(true);

    useChatStore.setState({ sending: false });
    await vi.runOnlyPendingTimersAsync();
  });

  it('should prefer derived titles from sessions.list and avoid extra history fetches for labeled sessions', async () => {
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockImplementation(async (method, params) => {
      if (method === 'sessions.list') {
        expect(params).toMatchObject({
          includeDerivedTitles: true,
          includeLastMessage: true,
        });
        return {
          sessions: [
            {
              key: 'agent:main:main',
              displayName: 'Main',
              updatedAt: 100,
            },
            {
              key: 'agent:main:session-1',
              displayName: 'session-1',
              derivedTitle: 'Customer Follow-up',
              lastMessagePreview: 'Latest reply',
              updatedAt: 200,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        throw new Error('chat.history should not be called when derived titles are already available');
      }
      throw new Error(`Unexpected RPC method: ${String(method)}`);
    });

    await useChatStore.getState().loadSessions({ preserveCurrent: true, warmLabels: true });

    const state = useChatStore.getState();
    expect(state.sessionLabels['agent:main:session-1']).toBe('Customer Follow-up');
    expect(state.sessionLastActivity['agent:main:session-1']).toBe(200);
    expect(state.sessions.find((session) => session.key === 'agent:main:session-1')?.lastMessagePreview)
      .toBe('Latest reply');

    rpcMock.mockRestore();
  });

  it('should still warm sidebar labels for non-main sessions when displayName is only the agent name', async () => {
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockImplementation(async (method, params) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:main',
              displayName: 'Main',
              updatedAt: 100,
            },
            {
              key: 'agent:main:session-2',
              displayName: 'Main',
              updatedAt: 200,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        expect(params).toMatchObject({ sessionKey: 'agent:main:session-2', limit: 1000 });
        return {
          messages: [
            { role: 'user', content: 'Previous conversation title', timestamp: 250 },
          ],
        };
      }
      throw new Error(`Unexpected RPC method: ${String(method)}`);
    });

    await useChatStore.getState().loadSessions({ preserveCurrent: true, warmLabels: true });
    await Promise.resolve();
    await Promise.resolve();

    const state = useChatStore.getState();
    expect(state.sessionLabels['agent:main:session-2']).toBe('Previous conversation title');

    rpcMock.mockRestore();
  });

  it('should strip inbound metadata blocks before deriving sidebar titles', async () => {
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockImplementation(async (method, params) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-3',
              displayName: 'Main',
              updatedAt: 300,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        expect(params).toMatchObject({ sessionKey: 'agent:main:session-3', limit: 1000 });
        return {
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Conversation info (untrusted metadata):\n```json\n{\"message_id\":\"123\"}\n```\n\nSender (untrusted metadata):\n```json\n{\"name\":\"alice\"}\n```\n\nActual customer request',
                },
              ],
              timestamp: 350,
            },
          ],
        };
      }
      throw new Error(`Unexpected RPC method: ${String(method)}`);
    });

    await useChatStore.getState().loadSessions({ preserveCurrent: true, warmLabels: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(useChatStore.getState().sessionLabels['agent:main:session-3']).toBe('Actual customer request');

    rpcMock.mockRestore();
  });

  it('should skip synthetic session-start prompts when warming sidebar titles', async () => {
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockImplementation(async (method, params) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-4',
              displayName: 'Main',
              updatedAt: 400,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        expect(params).toMatchObject({ sessionKey: 'agent:main:session-4', limit: 1000 });
        return {
          messages: [
            {
              role: 'user',
              content: 'A new session was started via /new or /reset. Run your Session Startup sequence - read the required files before responding to the user.',
              timestamp: 100,
            },
            {
              role: 'assistant',
              content: 'Hello',
              timestamp: 110,
            },
            {
              role: 'user',
              content: '真实历史标题',
              timestamp: 120,
            },
          ],
        };
      }
      throw new Error(`Unexpected RPC method: ${String(method)}`);
    });

    await useChatStore.getState().loadSessions({ preserveCurrent: true, warmLabels: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(useChatStore.getState().sessionLabels['agent:main:session-4']).toBe('真实历史标题');

    rpcMock.mockRestore();
  });
});
