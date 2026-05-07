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

  it('creates an agent without writing commands.restart into openclaw.json', async () => {
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

    const snapshot = await createAgent('Helper');
    expect(snapshot.agents.some((agent) => agent.id === 'helper')).toBe(true);

    const config = await readOpenClawJson();
    expect(config.commands).toEqual({ custom: 'keep-me' });
  });

  it('deletes the config entry, bindings, runtime directory, and managed workspace for a removed agent', async () => {
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

    const snapshot = await deleteAgentConfig('test2');

    expect(snapshot.agents.map((agent) => agent.id)).toEqual(['main', 'test3']);
    expect(snapshot.channelOwners.feishu).toBeUndefined();

    const config = await readOpenClawJson();
    expect(
      (config.agents as { list: Array<{ id: string }> }).list.map((agent) => agent.id)
    ).toEqual(['main', 'test3']);
    expect(config.bindings).toEqual([]);
    await expect(access(test2RuntimeDir)).rejects.toThrow();
    await expect(access(test2WorkspaceDir)).rejects.toThrow();

    infoSpy.mockRestore();
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

    await deleteAgentConfig('test2');

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
    const snapshot = await clearAllChannelBindings('wecom');

    expect(snapshot.channelOwners.wecom).toBeUndefined();
    expect(snapshot.channelAccountOwners['wecom:corp-b']).toBeUndefined();

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
