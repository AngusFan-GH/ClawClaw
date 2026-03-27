import { describe, expect, it } from 'vitest';
import { buildUnifiedSkillList, summarizeGatewaySkillSources } from '../../electron/utils/skill-list';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

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

  it('includes project pre-installed skills from metadata even when not yet loaded in gateway', () => {
    const skills = buildUnifiedSkillList({
      gatewayRunning: true,
      metadataMap: {
        'starter-preinstalled': {
          slug: 'starter-preinstalled',
          name: 'Starter Skill',
          description: 'Bundled by app resources',
          skillKey: 'starter-skill',
          isProjectBundled: true,
          requires: {},
        },
      },
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'starter-skill',
      slug: 'starter-preinstalled',
      name: 'Starter Skill',
      isPreinstalled: true,
      installedOnDisk: true,
      disabled: false,
      enabled: true,
    });
  });

  it('orders source dirs with OpenClaw precedence (extra -> ... -> workspace)', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-skilldirs-'));
    const workspaceDir = join(root, 'workspace');
    const workspaceSkillsDir = join(workspaceDir, 'skills');
    const projectAgentsDir = join(workspaceDir, '.agents', 'skills');
    const managedDir = join(root, 'managed');
    const bundledRoot = join(root, 'bundled');
    const bundledBase = join(bundledRoot, 'skill-b');
    const extraRoot = join(root, 'extra');
    const extraBase = join(extraRoot, 'skill-c');

    try {
      mkdirSync(workspaceSkillsDir, { recursive: true });
      mkdirSync(projectAgentsDir, { recursive: true });
      mkdirSync(managedDir, { recursive: true });
      mkdirSync(bundledBase, { recursive: true });
      mkdirSync(extraBase, { recursive: true });

      const summary = summarizeGatewaySkillSources({
        gatewaySkills: [
          { skillKey: 'a', source: 'openclaw-workspace', baseDir: join(workspaceSkillsDir, 'a') },
          { skillKey: 'b', source: 'openclaw-bundled', baseDir: bundledBase },
          { skillKey: 'c', source: 'openclaw-extra', baseDir: extraBase },
        ],
        workspaceDir,
        managedSkillsDir: managedDir,
      });

      const keys = summary.dirs.map((item) => item.key);
      const expected = [
        'extra',
        'bundled',
        'managed',
        'project_agents',
        'workspace',
      ];
      if (summary.dirs.some((item) => item.path === join(homedir(), '.agents', 'skills'))) {
        expect(keys).toEqual(['extra', 'bundled', 'managed', 'personal_agents', 'project_agents', 'workspace']);
      } else {
        expect(keys).toEqual(expected);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
