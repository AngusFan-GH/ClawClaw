/**
 * Zustand Stores Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isBackgroundSession, useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useRuntimeApplyStore } from '@/stores/runtime-apply';
import * as hostApi from '@/lib/host-api';

const actualLoadHistory = useChatStore.getState().loadHistory;

describe('Settings Store', () => {
  beforeEach(() => {
    vi.spyOn(hostApi, 'hostApiFetch').mockResolvedValue({ success: true } as never);
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
    const invoke = vi.mocked(window.desktop.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({ success: true, result: { ok: true } });

    const result = await useGatewayStore.getState().rpc<{ ok: boolean }>('chat.history', { limit: 10 }, 5000);

    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('gateway:rpc', 'chat.history', { limit: 10 }, 5000);
  });
});

describe('Agents Store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAgentsStore.setState({
      agents: [],
      defaultAgentId: 'main',
      mainKey: 'main',
      scope: null,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
      loading: false,
      error: null,
    });
    useRuntimeApplyStore.setState({
      plan: {
        pending: [],
        count: 0,
        requires: 'none',
        action: 'none',
      },
      loading: false,
      applying: false,
      error: null,
    });
    useGatewayStore.setState({
      status: { state: 'running', port: 18789 },
      lifecycle: { state: 'idle' },
      health: null,
      isInitialized: false,
      lastError: null,
      overlaySuppressed: false,
    });
  });

  it('keeps the local agents snapshot when agent changes are pending apply', async () => {
    vi.spyOn(hostApi, 'hostApiFetch').mockResolvedValueOnce({
      success: true,
      agents: [
        {
          id: 'main',
          name: 'Main',
          isDefault: true,
          modelDisplay: 'Not configured',
          workspace: '/tmp/main',
          agentDir: '/tmp/main/agent',
          inheritedModel: false,
          channelTypes: [],
          channelBindings: [],
        },
      ],
      defaultAgentId: 'main',
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    });
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockResolvedValue({
      defaultId: 'main',
      agents: [
        { id: 'main', name: 'Main' },
        { id: 'ghost', name: 'Ghost Agent' },
      ],
    });
    useRuntimeApplyStore.setState({
      plan: {
        pending: [
          {
            domain: 'agents',
            label: '分身配置',
            reason: 'delete-agent',
            source: 'delete-agent',
            requires: 'reload',
          },
        ],
        count: 1,
        requires: 'reload',
        action: 'reload',
      },
    });

    await useAgentsStore.getState().fetchAgents();

    expect(useAgentsStore.getState().agents.map((agent) => agent.gateway.id)).toEqual(['main']);
    expect(rpcMock).not.toHaveBeenCalled();
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
      terminalHistoryReconciling: false,
      queueFlushToken: 0,
      lastTerminalRunId: null,
      chatQueue: [],
      compactionStatus: null,
      fallbackStatus: null,
      sessions: [{ key: 'agent:main:main', displayName: 'Main' }],
      sessionsLoading: false,
      sessionsLoadingMore: false,
      sessionsHydrated: false,
      sessionsHasMore: false,
      sessionsNextCursor: null,
      sessionLabels: {},
      sessionLastActivity: {},
      loadHistory: actualLoadHistory,
    });
  });

  it('should clear loading when a stale history request is no longer current', async () => {
    let resolveFirst:
      | ((value: { success: true; messages: never[]; hasMore: false; nextCursor: null }) => void)
      | undefined;
    const historyMock = vi
      .spyOn(hostApi, 'hostApiFetch')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve as (
              value: { success: true; messages: never[]; hasMore: false; nextCursor: null }
            ) => void;
          }),
      )
      .mockResolvedValueOnce({ success: true, messages: [], hasMore: false, nextCursor: null });

    const firstLoad = useChatStore.getState().loadHistory(false);
    useChatStore.setState({ currentSessionKey: 'agent:main:other' });
    const secondLoad = useChatStore.getState().loadHistory(false);

    resolveFirst?.({ success: true, messages: [], hasMore: false, nextCursor: null });

    await Promise.all([firstLoad, secondLoad]);

    expect(historyMock).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().loading).toBe(false);

    historyMock.mockRestore();
  });

  it('should adopt an external agent run without polling history mid-run', async () => {
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

    expect(loadHistoryMock).not.toHaveBeenCalled();

    useChatStore.setState({ sending: false });
    await vi.runOnlyPendingTimersAsync();
  });

  it('should bind a local run id before chat.send returns gateway metadata', async () => {
    const rpcMock = vi
      .spyOn(useGatewayStore.getState(), 'rpc')
      .mockResolvedValueOnce({});
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', displayName: 'Main' }],
      currentSessionKey: 'agent:main:main',
      sending: false,
      activeRunId: null,
      allowedModelRefs: [],
      defaultModelRef: undefined,
    });

    await useChatStore.getState().sendMessage('hello');

    const state = useChatStore.getState();
    expect(state.sending).toBe(true);
    expect(state.activeRunId).toBeTruthy();
    expect(state.pendingUserMessage?.idempotencyKey).toBe(state.activeRunId);
    expect(rpcMock).toHaveBeenCalledWith(
      'chat.send',
      expect.objectContaining({
        sessionKey: 'agent:main:main',
        message: 'hello',
        deliver: false,
        idempotencyKey: state.activeRunId,
      }),
      135_000,
    );

    useChatStore.setState({ sending: false, activeRunId: null });
    rpcMock.mockRestore();
  });

  it('should persist a locally selected thinking level before first send', async () => {
    const rpcMock = vi
      .spyOn(useGatewayStore.getState(), 'rpc')
      .mockImplementation(async (method) => {
        if (method === 'sessions.patch') return {};
        if (method === 'chat.send') return {};
        throw new Error(`Unexpected RPC method: ${String(method)}`);
      });
    useChatStore.setState({
      sessions: [{ key: 'agent:main:session-local', displayName: 'session-local', thinkingLevel: 'high' }],
      currentSessionKey: 'agent:main:session-local',
      pendingLocalSessionKeys: { 'agent:main:session-local': true },
      sending: false,
      activeRunId: null,
      allowedModelRefs: [],
      defaultModelRef: undefined,
    });

    await useChatStore.getState().sendMessage('hello');

    expect(rpcMock).toHaveBeenNthCalledWith(
      1,
      'sessions.patch',
      {
        key: 'agent:main:session-local',
        thinkingLevel: 'high',
      },
    );
    expect(rpcMock).toHaveBeenNthCalledWith(
      2,
      'chat.send',
      expect.objectContaining({
        sessionKey: 'agent:main:session-local',
        message: 'hello',
      }),
      135_000,
    );

    useChatStore.setState({ sending: false, activeRunId: null });
    rpcMock.mockRestore();
  });

  it('should emit queue flush immediately for terminal final without tool events', async () => {
    let resolveHistory: (() => void) | undefined;
    const loadHistoryMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveHistory = resolve;
        }),
    );
    useChatStore.setState({
      loadHistory: loadHistoryMock,
      sessions: [{ key: 'agent:main:main', displayName: 'Main' }],
      currentSessionKey: 'agent:main:main',
      sending: true,
      activeRunId: 'run-final-1',
      pendingFinal: false,
      queueFlushToken: 0,
      lastTerminalRunId: null,
    });

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-final-1',
      sessionKey: 'agent:main:main',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
      },
    });

    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
    expect(useChatStore.getState().pendingFinal).toBe(false);
    expect(useChatStore.getState().terminalHistoryReconciling).toBe(false);
    expect(useChatStore.getState().queueFlushToken).toBe(1);
    expect(useChatStore.getState().lastTerminalRunId).toBe('run-final-1');
    expect(loadHistoryMock).toHaveBeenCalledWith(true);

    resolveHistory?.();
    await Promise.resolve();

    expect(useChatStore.getState().terminalHistoryReconciling).toBe(false);
    expect(useChatStore.getState().queueFlushToken).toBe(1);
    expect(useChatStore.getState().lastTerminalRunId).toBe('run-final-1');
  });

  it('should clear queued pending-run messages when requesting a queue flush for that run', () => {
    useChatStore.setState({
      chatQueue: [],
      queueFlushToken: 0,
      lastTerminalRunId: null,
    });

    useChatStore.getState().enqueueChatMessage({ text: 'next message' });
    useChatStore.getState().enqueueChatMessage({
      text: '/steer follow up',
      pendingRunId: 'run-pending',
    });

    expect(useChatStore.getState().chatQueue).toHaveLength(2);

    useChatStore.getState().requestQueueFlush('run-pending');

    const state = useChatStore.getState();
    expect(state.chatQueue).toHaveLength(1);
    expect(state.chatQueue[0].text).toBe('next message');
    expect(state.queueFlushToken).toBe(1);
    expect(state.lastTerminalRunId).toBe('run-pending');
  });

  it('should delay queue flush for terminal final with tool events until history reconciliation finishes', async () => {
    let resolveHistory: (() => void) | undefined;
    const loadHistoryMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveHistory = resolve;
        }),
    );
    useChatStore.setState({
      loadHistory: loadHistoryMock,
      sessions: [{ key: 'agent:main:main', displayName: 'Main' }],
      currentSessionKey: 'agent:main:main',
      sending: true,
      activeRunId: 'run-final-tools',
      pendingFinal: false,
      queueFlushToken: 0,
      lastTerminalRunId: null,
      toolStreamOrder: ['tool-1'],
    });

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-final-tools',
      sessionKey: 'agent:main:main',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
      },
    });

    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
    expect(useChatStore.getState().pendingFinal).toBe(false);
    expect(useChatStore.getState().terminalHistoryReconciling).toBe(true);
    expect(useChatStore.getState().queueFlushToken).toBe(0);
    expect(loadHistoryMock).toHaveBeenCalledWith(true);

    resolveHistory?.();
    await Promise.resolve();

    expect(useChatStore.getState().terminalHistoryReconciling).toBe(false);
    expect(useChatStore.getState().queueFlushToken).toBe(1);
    expect(useChatStore.getState().lastTerminalRunId).toBe('run-final-tools');
  });

  it('should preserve an in-flight response while the gateway is reconnecting', () => {
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
    expect(state.sending).toBe(true);
    expect(state.activeRunId).toBe('run-1');
    expect(state.pendingFinal).toBe(true);
    expect(state.messages).toHaveLength(1);
    expect(state.error).toContain('Gateway is reconnecting');
  });

  it('should refresh and clear reconnecting errors when the gateway is running again', () => {
    const loadHistoryMock = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      messages: [{ role: 'user', content: 'hello', id: 'u1' }],
      sending: true,
      activeRunId: 'run-1',
      pendingFinal: true,
      error: 'Gateway is reconnecting. The current response state is being preserved and will refresh when the Gateway is back.',
      loadHistory: loadHistoryMock,
    });

    useChatStore.getState().handleGatewayStatusChange('running');

    expect(loadHistoryMock).toHaveBeenCalledWith(true);
    expect(useChatStore.getState().error).toBeNull();
  });

  it('should keep the optimistic user message when chat.send fails due to gateway disconnect', async () => {
    const rpcMock = vi
      .spyOn(useGatewayStore.getState(), 'rpc')
      .mockRejectedValueOnce(new Error('Gateway connection closed during request'));

    await useChatStore.getState().sendMessage('hello after disconnect');

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.pendingUserMessage?.role).toBe('user');
    expect(state.pendingUserMessage?.content).toBe('hello after disconnect');
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.error).toContain('message was kept locally');

    rpcMock.mockRestore();
  });

  it('should prefer derived titles from sessions.list and avoid extra history fetches for labeled sessions', async () => {
    const hostApiSpy = vi.spyOn(hostApi, 'hostApiFetch').mockImplementation(async (path) => {
      if (path === '/api/sessions/list') {
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
          hasMore: false,
          nextCursor: null,
        };
      }
      throw new Error(`Unexpected host API path: ${String(path)}`);
    });
    const rpcMock = vi.spyOn(useGatewayStore.getState(), 'rpc').mockImplementation(async (method) => {
      if (method === 'chat.history') {
        throw new Error('chat.history should not be called when derived titles are already available');
      }
      throw new Error(`Unexpected RPC method: ${String(method)}`);
    });

    await useChatStore.getState().loadSessions({ preserveCurrent: true, warmLabels: true });

    const state = useChatStore.getState();
    expect(state.sessionLabels['agent:main:session-1']).toBe('Customer Follow-up');
    expect(state.sessionLastActivity['agent:main:session-1']).toBe(200000);
    expect(state.sessions.find((session) => session.key === 'agent:main:session-1')?.lastMessagePreview)
      .toBe('Latest reply');

    hostApiSpy.mockRestore();
    rpcMock.mockRestore();
  });

  it('should keep a brand-new unlabeled local session selected instead of remapping it to the latest real session', async () => {
    const hostApiSpy = vi.spyOn(hostApi, 'hostApiFetch').mockImplementation(async (path) => {
      if (path === '/api/sessions/list') {
        return {
          sessions: [
            {
              key: 'agent:main:main',
              displayName: 'Main',
              updatedAt: 100,
            },
            {
              key: 'agent:main:session-existing',
              displayName: 'Existing',
              derivedTitle: 'Existing conversation',
              updatedAt: 200,
            },
          ],
          hasMore: false,
          nextCursor: null,
        };
      }
      throw new Error(`Unexpected host API path: ${String(path)}`);
    });
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-local',
      sessions: [
        { key: 'agent:main:main', displayName: 'Main' },
        { key: 'agent:main:session-existing', displayName: 'Existing' },
        { key: 'agent:main:session-local', displayName: 'session-local' },
      ],
      pendingLocalSessionKeys: { 'agent:main:session-local': true },
      sessionLabels: {},
      sessionLastActivity: {
        'agent:main:session-local': 205000,
        'agent:main:session-existing': 200000,
      },
    });

    await useChatStore.getState().loadSessions({ preserveCurrent: true, warmLabels: true });

    const state = useChatStore.getState();
    expect(state.currentSessionKey).toBe('agent:main:session-local');
    expect(state.sessions.some((session) => session.key === 'agent:main:session-local')).toBe(true);

    hostApiSpy.mockRestore();
  });

  it('should append the next sessions page when loading more sidebar sessions', async () => {
    const hostApiSpy = vi.spyOn(hostApi, 'hostApiFetch').mockImplementation(async (path, init) => {
      if (path !== '/api/sessions/list') {
        throw new Error(`Unexpected host API path: ${String(path)}`);
      }

      const body = JSON.parse(String(init?.body ?? '{}')) as { cursor?: string };
      if (!body.cursor) {
        return {
          sessions: [
            {
              key: 'agent:main:main',
              displayName: 'Main',
              updatedAt: 100,
            },
            {
              key: 'agent:main:session-page-1',
              displayName: 'Page 1',
              updatedAt: 90,
            },
          ],
          hasMore: true,
          nextCursor: 'cursor-2',
        };
      }

      expect(body.cursor).toBe('cursor-2');
      return {
        sessions: [
          {
            key: 'agent:main:session-page-2',
            displayName: 'Page 2',
            updatedAt: 80,
          },
        ],
        hasMore: false,
        nextCursor: null,
      };
    });

    await useChatStore.getState().loadSessions({ preserveCurrent: true, warmLabels: false });
    await useChatStore.getState().loadMoreSessions();

    const state = useChatStore.getState();
    expect(state.sessions.map((session) => session.key)).toEqual([
      'agent:main:main',
      'agent:main:session-page-1',
      'agent:main:session-page-2',
    ]);
    expect(state.sessionsHasMore).toBe(false);
    expect(state.sessionsNextCursor).toBeNull();

    hostApiSpy.mockRestore();
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
      phase: 'active',
      runId: 'run-compaction',
      completedAt: null,
    });

    useChatStore.getState().handleAgentEvent({
      runId: 'run-compaction',
      sessionKey: 'agent:main:main',
      stream: 'compaction',
      data: { phase: 'end', completed: true },
    });

    expect(useChatStore.getState().compactionStatus).toMatchObject({
      phase: 'complete',
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(useChatStore.getState().compactionStatus).toBeNull();
  });

  it('should keep compaction retrying until matching lifecycle end', async () => {
    vi.useFakeTimers();

    useChatStore.getState().handleAgentEvent({
      runId: 'run-compaction-retry',
      sessionKey: 'agent:main:main',
      stream: 'compaction',
      data: { phase: 'start' },
    });
    useChatStore.getState().handleAgentEvent({
      runId: 'run-compaction-retry',
      sessionKey: 'agent:main:main',
      stream: 'compaction',
      data: { phase: 'end', completed: true, willRetry: true },
    });

    expect(useChatStore.getState().compactionStatus).toMatchObject({
      phase: 'retrying',
      runId: 'run-compaction-retry',
      completedAt: null,
    });

    useChatStore.getState().handleAgentEvent({
      runId: 'run-compaction-retry',
      sessionKey: 'agent:main:main',
      stream: 'lifecycle',
      data: { phase: 'end' },
    });

    expect(useChatStore.getState().compactionStatus).toMatchObject({
      phase: 'complete',
      runId: 'run-compaction-retry',
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
    const hostApiSpy = vi.spyOn(hostApi, 'hostApiFetch').mockResolvedValue({
      success: true,
      messages: [],
      hasMore: false,
      nextCursor: null,
    } as never);

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

    hostApiSpy.mockRestore();
  });

  it('keeps the optimistic user message until authoritative history catches up', () => {
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

    expect(useChatStore.getState().pendingUserMessage).toMatchObject({
      role: 'user',
      content: '创建一个定时任务，每10分钟告诉我一次几点了。',
    });
  });

  it('keeps the optimistic user message when assistant final arrives before history catches up', () => {
    const loadHistoryMock = vi.fn().mockResolvedValue(undefined);

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sending: true,
      activeRunId: 'run-final-before-history',
      pendingUserMessage: {
        role: 'user',
        content: '数据已验证准确！现在生成PPT',
        id: 'pending-user-before-history',
        timestamp: 1_000,
      },
      loadHistory: loadHistoryMock,
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-final-before-history',
      sessionKey: 'agent:main:main',
      state: 'final',
      message: {
        role: 'assistant',
        content: '好的，我现在生成 PPT。',
        id: 'assistant-final-before-history',
      },
    });

    expect(useChatStore.getState().pendingUserMessage).toMatchObject({
      role: 'user',
      content: '数据已验证准确！现在生成PPT',
    });
    expect(useChatStore.getState().pendingAssistantMessage).toMatchObject({
      role: 'assistant',
      content: '好的，我现在生成 PPT。',
    });
    expect(loadHistoryMock).toHaveBeenCalledWith(true);
  });

  it('keeps the pending assistant final when authoritative history has not caught up', async () => {
    const historyMock = vi.spyOn(hostApi, 'hostApiFetch').mockResolvedValue({
      success: true,
      messages: [
        {
          role: 'user',
          content: '数据已验证准确！现在生成PPT',
          id: 'history-user-before-final',
          timestamp: 1_000,
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'write', input: { path: 'deck.pptx' } }],
          id: 'history-tool-before-final',
          timestamp: 1_500,
        },
      ],
      hasMore: false,
      nextCursor: null,
    });

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      messages: [{ role: 'user', content: '数据已验证准确！现在生成PPT', id: 'existing-user' }],
      sending: false,
      activeRunId: null,
      pendingFinal: true,
      lastUserMessageAt: 1_000,
      pendingAssistantMessage: {
        role: 'assistant',
        content: '好的，我现在生成 PPT。',
        id: 'assistant-final-before-history',
        timestamp: 2_000,
      },
    });

    await useChatStore.getState().loadHistory(true);

    expect(useChatStore.getState().pendingAssistantMessage).toMatchObject({
      role: 'assistant',
      content: '好的，我现在生成 PPT。',
    });

    historyMock.mockRestore();
  });

  it('keeps streamed assistant text when the final event has no message like OpenClaw dashboard', () => {
    const loadHistoryMock = vi.fn().mockResolvedValue(undefined);

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sending: true,
      activeRunId: 'run-empty-final',
      streamingMessage: {
        role: 'assistant',
        content: [{ type: 'text', text: '我已经完成下载，并保存到了本地。' }],
      },
      loadHistory: loadHistoryMock,
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-empty-final',
      sessionKey: 'agent:main:main',
      state: 'final',
    });

    expect(useChatStore.getState().pendingAssistantMessage).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: '我已经完成下载，并保存到了本地。' }],
    });
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
    expect(loadHistoryMock).toHaveBeenCalledWith(true);
  });

  it('keeps streamed assistant text when the final assistant payload is empty', () => {
    const loadHistoryMock = vi.fn().mockResolvedValue(undefined);

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sending: true,
      activeRunId: 'run-empty-assistant-final',
      streamingMessage: {
        role: 'assistant',
        content: [{ type: 'text', text: '工具执行完成，结果已整理。' }],
      },
      loadHistory: loadHistoryMock,
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-empty-assistant-final',
      sessionKey: 'agent:main:main',
      state: 'final',
      message: {
        role: 'assistant',
        content: [],
      },
    });

    expect(useChatStore.getState().pendingAssistantMessage).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: '工具执行完成，结果已整理。' }],
    });
    expect(useChatStore.getState().pendingFinal).toBe(false);
    expect(loadHistoryMock).toHaveBeenCalledWith(true);
  });

  it('clears the pending assistant final once authoritative history catches up', async () => {
    const historyMock = vi.spyOn(hostApi, 'hostApiFetch').mockResolvedValue({
      success: true,
      messages: [
        {
          role: 'user',
          content: '数据已验证准确！现在生成PPT',
          id: 'history-user-with-final',
          timestamp: 1_000,
        },
        {
          role: 'assistant',
          content: '好的，我现在生成 PPT。',
          id: 'assistant-final-before-history',
          timestamp: 2_000,
        },
      ],
      hasMore: false,
      nextCursor: null,
    });

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      messages: [{ role: 'user', content: '数据已验证准确！现在生成PPT', id: 'existing-user' }],
      sending: false,
      activeRunId: null,
      pendingFinal: true,
      lastUserMessageAt: 1_000,
      pendingAssistantMessage: {
        role: 'assistant',
        content: '好的，我现在生成 PPT。',
        id: 'assistant-final-before-history',
        timestamp: 2_000,
      },
    });

    await useChatStore.getState().loadHistory(true);

    expect(useChatStore.getState().pendingAssistantMessage).toBeNull();
    expect(useChatStore.getState().pendingFinal).toBe(false);

    historyMock.mockRestore();
  });

  it('hides synthetic transcript repair tool results from chat history', async () => {
    const historyMock = vi.spyOn(hostApi, 'hostApiFetch').mockResolvedValue({
      success: true,
      messages: [
        {
          role: 'user',
          content: 'hello',
          id: 'history-user-visible',
          timestamp: 1_000,
        },
        {
          role: 'toolresult',
          content:
            '[openclaw] missing tool result in session history; inserted synthetic error result for transcript repair.',
          id: 'synthetic-repair-result',
          timestamp: 1_500,
        },
        {
          role: 'assistant',
          content: 'hi',
          id: 'history-assistant-visible',
          timestamp: 2_000,
        },
      ],
      hasMore: false,
      nextCursor: null,
    });

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      messages: [{ role: 'user', content: 'existing', id: 'existing-user' }],
    });

    await useChatStore.getState().loadHistory(true);

    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'history-user-visible',
      'history-assistant-visible',
    ]);

    historyMock.mockRestore();
  });

  it('appends final messages from another run on the current session like OpenClaw dashboard', () => {
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      messages: [{ role: 'user', content: 'start', id: 'user-1' }],
      sending: true,
      activeRunId: 'run-current',
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-other',
      sessionKey: 'agent:main:main',
      state: 'final',
      message: {
        role: 'assistant',
        content: 'Sub-agent finished.',
        id: 'assistant-other-run',
      },
    });

    expect(useChatStore.getState().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'assistant-other-run',
        role: 'assistant',
        content: 'Sub-agent finished.',
      }),
    ]));
    expect(useChatStore.getState().activeRunId).toBe('run-current');
  });

  it('keeps streamed assistant text when a run is aborted', () => {
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sending: true,
      activeRunId: 'run-abort-1',
      streamingMessage: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Partial answer before abort.' }],
      },
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-abort-1',
      sessionKey: 'agent:main:main',
      state: 'aborted',
    });

    expect(useChatStore.getState().pendingAssistantMessage).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Partial answer before abort.' }],
    });
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
  });

  it('should terminate the active run and flush queue on chat error', () => {
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main', displayName: 'Main' }],
      sending: true,
      activeRunId: 'run-error-1',
      pendingFinal: true,
      queueFlushToken: 0,
      lastTerminalRunId: null,
      streamingMessage: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Partial answer before error.' }],
      },
    });

    useChatStore.getState().handleChatEvent({
      runId: 'run-error-1',
      sessionKey: 'agent:main:main',
      state: 'error',
      errorMessage: 'provider failed',
    });

    const state = useChatStore.getState();
    expect(state.error).toBe('provider failed');
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.pendingFinal).toBe(false);
    expect(state.queueFlushToken).toBe(1);
    expect(state.lastTerminalRunId).toBe('run-error-1');
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
      nextCursor: null,
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
      earlierHistoryCursor: 'cursor-older-1',
    });

    await useChatStore.getState().loadEarlierHistory();

    expect(hostApiSpy).toHaveBeenCalledWith('/api/sessions/history', {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: 'agent:main:main',
        limit: 200,
        cursor: 'cursor-older-1',
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
