import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawclaw-agent-config-${suffix}`,
    testUserData: `/tmp/clawclaw-agent-config-user-data-${suffix}`,
  };
});

vi.mock('os', () => {
  const mocked = { homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('agent config lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('lists configured agent ids from openclaw.json', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test3', name: 'test3' },
        ],
      },
    });

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main', 'test3']);
  });

  it('falls back to the implicit main agent when no list exists', async () => {
    await writeOpenClawJson({});

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main']);
  });

  it('updates an agent model and clears it back to inherited default', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.4',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'helper', name: 'Helper' },
        ],
      },
    });

    const { updateAgentSettings } = await import('@electron/utils/agent-config');

    const updated = await updateAgentSettings('helper', { model: 'minimax/MiniMax-M2.5' });
    const helper = updated.agents.find((agent) => agent.id === 'helper');
    expect(helper?.modelRef).toBe('minimax/MiniMax-M2.5');
    expect(helper?.inheritedModel).toBe(false);

    const cleared = await updateAgentSettings('helper', { model: null });
    const inherited = cleared.agents.find((agent) => agent.id === 'helper');
    expect(inherited?.modelRef).toBe('openai/gpt-5.4');
    expect(inherited?.inheritedModel).toBe(true);

    const config = await readOpenClawJson();
    expect((config.agents as { list: Array<{ id: string; model?: string }> }).list).toEqual([
      { id: 'main', name: 'Main', default: true },
      { id: 'helper', name: 'Helper' },
    ]);
  });

  it('creates an agent as a draft without mutating openclaw.json until apply', async () => {
    await writeOpenClawJson({
      commands: {
        restart: true,
        custom: 'keep-me',
      },
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.openclaw', 'agents', 'main', 'agent'), { recursive: true });
    await mkdir(join(testHome, '.openclaw', 'workspace'), { recursive: true });
    await writeFile(join(testHome, '.openclaw', 'workspace', 'AGENTS.md'), '# main', 'utf8');

    const { createAgent } = await import('@electron/utils/agent-config');
    const {
      commitAgentDraftSession,
      finalizeAgentDraftSession,
    } = await import('@electron/services/agent-draft-session');

    const snapshot = await createAgent('Helper');
    expect(snapshot.agents.some((agent) => agent.id === 'helper')).toBe(true);

    const configBeforeApply = await readOpenClawJson();
    expect(configBeforeApply.commands).toEqual({ restart: true, custom: 'keep-me' });
    expect((configBeforeApply.agents as { list: Array<{ id: string }> }).list).toEqual([
      {
        id: 'main',
        name: 'Main',
        default: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
      },
    ]);

    await commitAgentDraftSession();

    const configAfterApply = await readOpenClawJson();
    expect(configAfterApply.commands).toEqual({ restart: true, custom: 'keep-me' });
    expect((configAfterApply.agents as { list: Array<{ id: string }> }).list.map((agent) => agent.id)).toEqual([
      'main',
      'helper',
    ]);

    await finalizeAgentDraftSession();
  });

  it('assigns a channel binding immediately without requiring agent apply', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'helper', name: 'Helper' },
        ],
      },
      channels: {
        'openclaw-weixin': {
          accounts: {
            'corp-a': {
              enabled: true,
            },
          },
          defaultAccount: 'corp-a',
        },
      },
      bindings: [],
    });

    const { assignChannelToAgent } = await import('@electron/utils/agent-config');

    const snapshot = await assignChannelToAgent('helper', 'wechat', 'corp-a');
    expect(snapshot.agents.some((agent) => agent.id === 'helper')).toBe(true);

    const config = await readOpenClawJson();
    expect(config.bindings).toEqual([
      {
        agentId: 'helper',
        match: {
          channel: 'openclaw-weixin',
          accountId: 'corp-a',
        },
      },
    ]);
  });

  it('deletes the agent as a draft and defers config/resource changes until apply', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'custom-custom27/MiniMax-M2.5',
            fallbacks: [],
          },
        },
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: '~/.openclaw/workspace-test2',
            agentDir: '~/.openclaw/agents/test2/agent',
          },
          {
            id: 'test3',
            name: 'test3',
            workspace: '~/.openclaw/workspace-test3',
            agentDir: '~/.openclaw/agents/test3/agent',
          },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
        },
      },
      bindings: [
        {
          agentId: 'test2',
          match: {
            channel: 'feishu',
          },
        },
      ],
    });

    const test2RuntimeDir = join(testHome, '.openclaw', 'agents', 'test2');
    const test2WorkspaceDir = join(testHome, '.openclaw', 'workspace-test2');
    await mkdir(join(test2RuntimeDir, 'agent'), { recursive: true });
    await mkdir(join(test2RuntimeDir, 'sessions'), { recursive: true });
    await mkdir(join(test2WorkspaceDir, '.openclaw'), { recursive: true });
    await writeFile(
      join(test2RuntimeDir, 'agent', 'auth-profiles.json'),
      JSON.stringify({ version: 1, profiles: {} }, null, 2),
      'utf8'
    );
    await writeFile(join(test2WorkspaceDir, 'AGENTS.md'), '# test2', 'utf8');

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');
    const {
      commitAgentDraftSession,
      finalizeAgentDraftSession,
    } = await import('@electron/services/agent-draft-session');

    const snapshot = await deleteAgentConfig('test2');

    expect(snapshot.agents.map((agent) => agent.id)).toEqual(['main', 'test3']);
    expect(snapshot.channelOwners.feishu).toBeUndefined();

    const configBeforeApply = await readOpenClawJson();
    expect(
      (configBeforeApply.agents as { list: Array<{ id: string }> }).list.map((agent) => agent.id)
    ).toEqual(['main', 'test2', 'test3']);
    expect(configBeforeApply.bindings).toEqual([
      {
        agentId: 'test2',
        match: {
          channel: 'feishu',
        },
      },
    ]);
    await expect(access(test2RuntimeDir)).resolves.toBeUndefined();
    await expect(access(test2WorkspaceDir)).resolves.toBeUndefined();

    await commitAgentDraftSession();

    const configAfterApply = await readOpenClawJson();
    expect(
      (configAfterApply.agents as { list: Array<{ id: string }> }).list.map((agent) => agent.id)
    ).toEqual(['main', 'test3']);
    expect(configAfterApply.bindings).toEqual([]);

    await finalizeAgentDraftSession();

    await expect(access(test2RuntimeDir)).rejects.toThrow();
    await expect(access(test2WorkspaceDir)).rejects.toThrow();

    infoSpy.mockRestore();
  });

  it('restores the previous agent config and managed directories when discarding a draft session', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'helper',
            name: 'Helper',
            workspace: '~/.openclaw/workspace-helper',
            agentDir: '~/.openclaw/agents/helper/agent',
          },
        ],
      },
      bindings: [
        {
          agentId: 'helper',
          match: {
            channel: 'feishu',
          },
        },
      ],
    });

    const helperRuntimeDir = join(testHome, '.openclaw', 'agents', 'helper');
    const helperWorkspaceDir = join(testHome, '.openclaw', 'workspace-helper');
    await mkdir(join(helperRuntimeDir, 'agent'), { recursive: true });
    await mkdir(helperWorkspaceDir, { recursive: true });
    await writeFile(join(helperWorkspaceDir, 'AGENTS.md'), '# helper', 'utf8');

    const { beginAgentDraftSession, discardAgentDraftSession } = await import('@electron/services/agent-draft-session');
    await beginAgentDraftSession();

    const { updateAgentSettings, deleteAgentConfig } = await import('@electron/utils/agent-config');
    await updateAgentSettings('helper', { name: 'Helper Draft', model: 'openai/gpt-5.5' });
    await deleteAgentConfig('helper');

    await discardAgentDraftSession();

    const config = await readOpenClawJson();
    expect(
      (config.agents as { list: Array<{ id: string; name?: string; model?: string }> }).list
    ).toEqual([
      {
        id: 'main',
        name: 'Main',
        default: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
      },
      {
        id: 'helper',
        name: 'Helper',
        workspace: '~/.openclaw/workspace-helper',
        agentDir: '~/.openclaw/agents/helper/agent',
      },
    ]);
    expect(config.bindings).toEqual([
      {
        agentId: 'helper',
        match: {
          channel: 'feishu',
        },
      },
    ]);
    await expect(access(helperRuntimeDir)).resolves.toBeUndefined();
    await expect(access(helperWorkspaceDir)).resolves.toBeUndefined();
  });

  it('preserves unmanaged custom workspaces when deleting an agent', async () => {
    const customWorkspaceDir = join(testHome, 'custom-workspace-test2');

    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: customWorkspaceDir,
            agentDir: '~/.openclaw/agents/test2/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.openclaw', 'agents', 'test2', 'agent'), { recursive: true });
    await mkdir(customWorkspaceDir, { recursive: true });
    await writeFile(join(customWorkspaceDir, 'AGENTS.md'), '# custom', 'utf8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');
    const {
      commitAgentDraftSession,
      finalizeAgentDraftSession,
    } = await import('@electron/services/agent-draft-session');

    await deleteAgentConfig('test2');
    await commitAgentDraftSession();
    await finalizeAgentDraftSession();

    await expect(access(customWorkspaceDir)).resolves.toBeUndefined();

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('clears all bindings for a deleted channel type', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'alpha', name: 'Alpha' },
          { id: 'beta', name: 'Beta' },
        ],
      },
      bindings: [
        {
          agentId: 'alpha',
          match: {
            channel: 'wecom',
          },
        },
        {
          agentId: 'beta',
          match: {
            channel: 'wecom',
            accountId: 'corp-b',
          },
        },
        {
          agentId: 'beta',
          match: {
            channel: 'telegram',
          },
        },
      ],
    });

    const { clearAllChannelBindings } = await import('@electron/utils/agent-config');
    const {
      beginChannelDraftSession: beginChannelsDraft,
      commitChannelDraftSession,
      finalizeChannelDraftSession,
    } = await import('@electron/services/channel-draft-session');
    await beginChannelsDraft();
    const snapshot = await clearAllChannelBindings('wecom', { mode: 'channel-draft' });

    expect(snapshot.channelOwners.wecom).toBeUndefined();
    expect(snapshot.channelAccountOwners['wecom:corp-b']).toBeUndefined();

    const configBeforeApply = await readOpenClawJson();
    expect(configBeforeApply.bindings).toEqual([
      {
        agentId: 'alpha',
        match: {
          channel: 'wecom',
        },
      },
      {
        agentId: 'beta',
        match: {
          channel: 'wecom',
          accountId: 'corp-b',
        },
      },
      {
        agentId: 'beta',
        match: {
          channel: 'telegram',
        },
      },
    ]);

    await commitChannelDraftSession();
    await finalizeChannelDraftSession();

    const config = await readOpenClawJson();
    expect(config.bindings).toEqual([
      {
        agentId: 'beta',
        match: {
          channel: 'telegram',
        },
      },
    ]);
  });
});
