/**
 * Zustand Stores Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isBackgroundSession, useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import * as hostApi from '@/lib/host-api';

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
      pendingSessionModelRefresh: false,
      sending: false,
      activeRunId: null,
      lastUserMessageAt: null,
      error: null,
      hasEarlierHistory: false,
      loadingEarlierHistory: false,
      pendingFinal: false,
      compactionStatus: null,
      fallbackStatus: null,
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

  it('should stop a stuck send when the gateway reports reconnecting', () => {
    useChatStore.setState({
      messages: [{ role: 'user', content: 'hello', id: 'u1' }],
      sending: true,
      activeRunId: 'run-1',
      pendingFinal: true,
      lastUserMessageAt: Date.now(),
      error: null,
    });

    useChatStore.getState().handleGatewayStatusChange('reconnecting');

    const state = useChatStore.getState();
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.pendingFinal).toBe(false);
    expect(state.messages).toHaveLength(1);
    expect(state.error).toContain('Gateway is reconnecting');
  });

  it('should keep the optimistic user message when chat.send fails due to gateway disconnect', async () => {
    const rpcMock = vi
      .spyOn(useGatewayStore.getState(), 'rpc')
      .mockRejectedValueOnce(new Error('Gateway connection closed during request'));

    await useChatStore.getState().sendMessage('hello after disconnect');

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('user');
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.error).toContain('message was kept locally');

    rpcMock.mockRestore();
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

  it('should strip injected timestamp prefixes when warming sidebar titles', async () => {
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockImplementation(async (method, params) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-5',
              displayName: 'Main',
              updatedAt: 500,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        expect(params).toMatchObject({ sessionKey: 'agent:main:session-5', limit: 1000 });
        return {
          messages: [
            {
              role: 'user',
              content: '[Wed 2026-04-08 10:30 GMT+8] 你好，请帮我整理今天的任务',
              timestamp: 510,
            },
          ],
        };
      }
      throw new Error(`Unexpected RPC method: ${String(method)}`);
    });

    await useChatStore.getState().loadSessions({ preserveCurrent: true, warmLabels: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(useChatStore.getState().sessionLabels['agent:main:session-5']).toBe('你好，请帮我整理今天的任务');

    rpcMock.mockRestore();
  });

  it('should classify cron and subagent sessions as background work', () => {
    expect(isBackgroundSession({ key: 'agent:main:cron:daily', kind: 'cron' })).toBe(true);
    expect(isBackgroundSession({ key: 'agent:main:subagent:child', kind: 'subagent' })).toBe(true);
    expect(isBackgroundSession({ key: 'agent:main:session-6', spawnedBy: 'agent:main:main' })).toBe(true);
    expect(isBackgroundSession({ key: 'agent:main:session-7', parentSessionKey: 'agent:main:main' })).toBe(true);
    expect(isBackgroundSession({ key: 'agent:main:session-8' })).toBe(false);
  });

  it('should track compaction start and completion from agent events', async () => {
    vi.useFakeTimers();

    useChatStore.getState().handleAgentEvent({
      runId: 'run-compaction',
      sessionKey: 'agent:main:main',
      stream: 'compaction',
      data: { phase: 'start' },
    });

    expect(useChatStore.getState().compactionStatus).toMatchObject({
      active: true,
      completedAt: null,
    });

    useChatStore.getState().handleAgentEvent({
      runId: 'run-compaction',
      sessionKey: 'agent:main:main',
      stream: 'compaction',
      data: { phase: 'end' },
    });

    expect(useChatStore.getState().compactionStatus).toMatchObject({
      active: false,
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(useChatStore.getState().compactionStatus).toBeNull();
  });

  it('should surface fallback active and cleared states from lifecycle events', async () => {
    vi.useFakeTimers();

    useChatStore.getState().handleAgentEvent({
      runId: 'run-fallback',
      sessionKey: 'agent:main:main',
      stream: 'lifecycle',
      data: {
        phase: 'fallback',
        selectedProvider: 'openrouter',
        selectedModel: 'anthropic/claude-3.7-sonnet',
        activeProvider: 'openai',
        activeModel: 'gpt-5.4',
        reasonSummary: 'Primary provider unavailable',
        attemptSummaries: ['openrouter/anthropic/claude-3.7-sonnet: timeout'],
      },
    });

    expect(useChatStore.getState().fallbackStatus).toMatchObject({
      phase: 'active',
      selected: 'openrouter/anthropic/claude-3.7-sonnet',
      active: 'openai/gpt-5.4',
      reason: 'Primary provider unavailable',
    });

    useChatStore.getState().handleAgentEvent({
      runId: 'run-fallback',
      sessionKey: 'agent:main:main',
      stream: 'lifecycle',
      data: {
        phase: 'fallback_cleared',
        selectedProvider: 'openrouter',
        selectedModel: 'anthropic/claude-3.7-sonnet',
        activeProvider: 'openai',
        activeModel: 'gpt-5.4',
      },
    });

    expect(useChatStore.getState().fallbackStatus).toMatchObject({
      phase: 'cleared',
      active: 'openrouter/anthropic/claude-3.7-sonnet',
      previous: 'openai/gpt-5.4',
    });

    await vi.advanceTimersByTimeAsync(8000);
    expect(useChatStore.getState().fallbackStatus).toBeNull();
  });

  it('should refresh sessions after a slash model command completes', () => {
    const loadSessionsMock = vi.fn().mockResolvedValue(undefined);

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      messages: [
        {
          role: 'user',
          content: '/model openai/gpt-5.4',
          id: 'user-model-1',
        },
      ],
      pendingSessionModelRefresh: true,
      sending: true,
      activeRunId: 'run-model-1',
      loadSessions: loadSessionsMock,
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-model-1',
      sessionKey: 'agent:main:main',
      state: 'final',
      message: {
        role: 'assistant',
        content: 'Switched to openai/gpt-5.4',
        id: 'assistant-model-1',
      },
    });

    expect(loadSessionsMock).toHaveBeenCalledWith({ preserveCurrent: true, warmLabels: true });
    expect(useChatStore.getState().pendingSessionModelRefresh).toBe(false);
  });

  it('clears the optimistic user message as soon as the active run starts producing events', () => {
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sending: true,
      activeRunId: 'run-user-1',
      pendingUserMessage: {
        role: 'user',
        content: '创建一个定时任务，每10分钟告诉我一次几点了。',
        id: 'pending-user-1',
        timestamp: 1_000,
      },
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-user-1',
      sessionKey: 'agent:main:main',
      state: 'delta',
      message: {
        role: 'assistant',
        content: '正在处理',
        id: 'assistant-delta-1',
      },
    });

    expect(useChatStore.getState().pendingUserMessage).toBeNull();
  });

  it('should abort the active run when policy changes require immediate effect', async () => {
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockResolvedValue({ success: true });

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sending: true,
      activeRunId: 'run-policy-1',
      pendingFinal: true,
      error: null,
    });

    const interrupted = await useChatStore
      .getState()
      .interruptActiveRunForPolicyChange('Policy changed');

    expect(interrupted).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('chat.abort', { sessionKey: 'agent:main:main' });
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
    expect(useChatStore.getState().pendingFinal).toBe(false);
    expect(useChatStore.getState().error).toBe('Policy changed');

    rpcMock.mockRestore();
  });

  it('should prepend older transcript messages when loading earlier history', async () => {
    const hostApiSpy = vi.spyOn(hostApi, 'hostApiFetch').mockResolvedValue({
      success: true,
      hasMore: false,
      anchorFound: true,
      messages: [
        { role: 'user', content: 'Earlier prompt', timestamp: 100, id: 'msg-earlier-user' },
        { role: 'assistant', content: 'Earlier answer', timestamp: 110, id: 'msg-earlier-assistant' },
        { role: 'user', content: 'Current prompt', timestamp: 200, id: 'msg-current-user' },
      ],
    });

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      messages: [
        { role: 'user', content: 'Current prompt', timestamp: 200, id: 'msg-current-user' },
        { role: 'assistant', content: 'Current answer', timestamp: 210, id: 'msg-current-assistant' },
      ],
      hasEarlierHistory: true,
      loadingEarlierHistory: false,
    });

    await useChatStore.getState().loadEarlierHistory();

    expect(hostApiSpy).toHaveBeenCalledWith('/api/sessions/history', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: 'agent:main:main',
        limit: 1000,
        before: {
          role: 'user',
          timestamp: 200,
          id: 'msg-current-user',
        },
      }),
    });

    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'msg-earlier-user',
      'msg-earlier-assistant',
      'msg-current-user',
      'msg-current-assistant',
    ]);
    expect(useChatStore.getState().hasEarlierHistory).toBe(false);
    expect(useChatStore.getState().historyWindowLimited).toBe(false);

    hostApiSpy.mockRestore();
  });
});
