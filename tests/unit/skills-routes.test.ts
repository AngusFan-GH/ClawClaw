import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const getAllSkillConfigsMock = vi.fn();
const getManagedInstalledSkillSlugsMock = vi.fn();
const getSkillMetadataMock = vi.fn();
const buildUnifiedSkillListMock = vi.fn();
const summarizeGatewaySkillSourcesMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/utils/skill-config', () => ({
  getAllSkillConfigs: (...args: unknown[]) => getAllSkillConfigsMock(...args),
  updateSkillConfig: vi.fn(),
}));

vi.mock('@electron/utils/skill-metadata', () => ({
  getManagedInstalledSkillSlugs: (...args: unknown[]) => getManagedInstalledSkillSlugsMock(...args),
  getSkillMetadata: (...args: unknown[]) => getSkillMetadataMock(...args),
}));

vi.mock('@electron/utils/skill-list', () => ({
  buildUnifiedSkillList: (...args: unknown[]) => buildUnifiedSkillListMock(...args),
  summarizeGatewaySkillSources: (...args: unknown[]) => summarizeGatewaySkillSourcesMock(...args),
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
    getSkillMetadataMock.mockResolvedValue({});
    buildUnifiedSkillListMock.mockReturnValue([]);
    summarizeGatewaySkillSourcesMock.mockReturnValue({ stats: [], dirs: [] });
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
});
