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
  });
});
