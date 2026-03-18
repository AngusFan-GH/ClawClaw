import { describe, expect, it } from 'vitest';
import { buildUnifiedSkillList } from '../../electron/utils/skill-list';

describe('buildUnifiedSkillList', () => {
  it('merges gateway, local, and metadata records into one skill', () => {
    const skills = buildUnifiedSkillList({
      gatewayRunning: true,
      gatewaySkills: [
        {
          skillKey: 'offline-reader',
          name: 'Offline Reader',
          disabled: false,
        },
      ],
      localInstalledSlugs: ['my-offline-skill'],
      metadataMap: {
        'my-offline-skill': {
          slug: 'my-offline-skill',
          name: 'Offline Reader',
          description: 'Offline package',
          skillKey: 'offline-reader',
          requires: {},
        },
        'offline-reader': {
          slug: 'my-offline-skill',
          name: 'Offline Reader',
          description: 'Offline package',
          skillKey: 'offline-reader',
          requires: {},
        },
      },
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'offline-reader',
      slug: 'my-offline-skill',
      name: 'Offline Reader',
      description: 'Offline package',
      loadedInGateway: true,
      installedOnDisk: true,
      runtimeStatus: 'loaded',
    });
  });
});
