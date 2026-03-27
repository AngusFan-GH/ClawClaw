import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const getAllSkillConfigsMock = vi.fn();
const getManagedInstalledSkillSlugsMock = vi.fn();
const getProjectBundledSkillSlugsMock = vi.fn();
const getSkillMetadataMock = vi.fn();
const buildUnifiedSkillListMock = vi.fn();
const summarizeGatewaySkillSourcesMock = vi.fn();
const listAgentsSnapshotMock = vi.fn();
const getOpenClawSkillsDirMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/utils/skill-config', () => ({
  getAllSkillConfigs: (...args: unknown[]) => getAllSkillConfigsMock(...args),
  updateSkillConfig: vi.fn(),
}));

vi.mock('@electron/utils/skill-metadata', () => ({
  getManagedInstalledSkillSlugs: (...args: unknown[]) => getManagedInstalledSkillSlugsMock(...args),
  getProjectBundledSkillSlugs: (...args: unknown[]) => getProjectBundledSkillSlugsMock(...args),
  getSkillMetadata: (...args: unknown[]) => getSkillMetadataMock(...args),
}));

vi.mock('@electron/utils/skill-list', () => ({
  buildUnifiedSkillList: (...args: unknown[]) => buildUnifiedSkillListMock(...args),
  summarizeGatewaySkillSources: (...args: unknown[]) => summarizeGatewaySkillSourcesMock(...args),
}));

vi.mock('@electron/utils/agent-config', () => ({
  listAgentsSnapshot: (...args: unknown[]) => listAgentsSnapshotMock(...args),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawSkillsDir: (...args: unknown[]) => getOpenClawSkillsDirMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: vi.fn(),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleSkillRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getAllSkillConfigsMock.mockResolvedValue({});
    getManagedInstalledSkillSlugsMock.mockResolvedValue([]);
    getProjectBundledSkillSlugsMock.mockResolvedValue([]);
    getSkillMetadataMock.mockResolvedValue({});
    buildUnifiedSkillListMock.mockReturnValue([]);
    summarizeGatewaySkillSourcesMock.mockReturnValue({ stats: [], dirs: [] });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', workspace: '/tmp/workspace-main' }],
      defaultAgentId: 'main',
    });
    getOpenClawSkillsDirMock.mockReturnValue('/tmp/managed');
  });

  it('passes agentId through to skills.status for scoped skill lists', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ skills: [], workspaceDir: '/tmp/ws', managedSkillsDir: '/tmp/managed' });
    const { handleSkillRoutes } = await import('@electron/api/routes/skills');

    const handled = await handleSkillRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/skills/list?agentId=agent-sales'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running' }),
          rpc: rpcMock,
        },
        clawHubService: {
          listInstalled: vi.fn().mockResolvedValue([]),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('skills.status', { agentId: 'agent-sales' }, 3000);
    expect(sendJsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      success: true,
      results: [],
      sourceStats: [],
      sourceDirs: [],
    });
  });

  it('uses local fallback workspace/managed dirs when gateway is not running', async () => {
    summarizeGatewaySkillSourcesMock.mockReturnValue({ stats: [], dirs: [{ key: 'managed', label: 'Managed skills', path: '/tmp/managed', count: 0 }] });
    const rpcMock = vi.fn();
    const { handleSkillRoutes } = await import('@electron/api/routes/skills');

    await handleSkillRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:3210/api/skills/list?agentId=main'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'stopped' }),
          rpc: rpcMock,
        },
        clawHubService: {
          listInstalled: vi.fn().mockResolvedValue([]),
        },
      } as never,
    );

    expect(rpcMock).not.toHaveBeenCalled();
    expect(summarizeGatewaySkillSourcesMock).toHaveBeenCalledWith({
      gatewaySkills: null,
      workspaceDir: '/tmp/workspace-main',
      managedSkillsDir: '/tmp/managed',
    });
  });
});
