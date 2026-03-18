import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

describe('skills store identity merge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('dedupes a local skill slug against gateway skillKey aliases', async () => {
    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      results: [
        {
          id: 'offline-reader',
          slug: 'my-offline-skill',
          name: 'Offline Reader',
          description: 'Offline package',
          enabled: true,
          runtimeEnabled: true,
          installedOnDisk: true,
          loadedInGateway: true,
          runtimeStatus: 'loaded',
        },
      ],
      sourceStats: [{ key: 'managed', label: 'Managed skills', count: 1 }],
      sourceDirs: [{ key: 'managed', label: 'Managed skills', path: '/tmp/skills', count: 1 }],
    });

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills();

    const skills = useSkillsStore.getState().skills;
    expect(skills).toHaveLength(1);
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/skills/list');
    expect(skills[0]).toMatchObject({
      id: 'offline-reader',
      slug: 'my-offline-skill',
      name: 'Offline Reader',
      loadedInGateway: true,
      installedOnDisk: true,
    });
    expect(useSkillsStore.getState().sourceStats).toEqual([
      { key: 'managed', label: 'Managed skills', count: 1 },
    ]);
  });

  it('fetches skills for a specific agent and remembers that scope for refreshes', async () => {
    hostApiFetchMock
      .mockResolvedValueOnce({
        success: true,
        results: [],
      })
      .mockResolvedValueOnce({
        success: true,
      })
      .mockResolvedValueOnce({
        success: true,
        results: [],
      });

    const { useSkillsStore } = await import('@/stores/skills');

    await useSkillsStore.getState().fetchSkills('agent-sales');
    await useSkillsStore.getState().installSkill('offline-reader');

    expect(hostApiFetchMock).toHaveBeenNthCalledWith(1, '/api/skills/list?agentId=agent-sales');
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/clawhub/install',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ slug: 'offline-reader', version: undefined }),
      }),
    );
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(3, '/api/skills/list?agentId=agent-sales');
    expect(useSkillsStore.getState().currentAgentId).toBe('agent-sales');
  });
});
