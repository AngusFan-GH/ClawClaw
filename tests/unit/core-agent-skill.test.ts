// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoreDatabase } from '@backend/core/db/database';
import { AgentStore } from '@backend/core/agent-store';
import { CoreSkillStore } from '@backend/core/skill-store';
import { tempDir } from './helpers/runtime-harness';
import { CoreError } from '@backend/core/errors';

function agents() {
  const dataDir = tempDir();
  const db = new CoreDatabase(join(dataDir, 'c.sqlite'));
  return { dataDir, db, store: new AgentStore(db) };
}

describe('AgentStore', () => {
  it('seeds a default agent and protects it from deletion', () => {
    const t = agents();
    const def = t.store.getDefault('default')!;
    expect(def.id).toBe('main');
    expect(() => t.store.delete('default', 'main')).toThrow(/default agent/i);
  });

  it('creates, updates policies and manages bindings', () => {
    const t = agents();
    const a = t.store.create('default', 'Researcher');
    t.store.update('default', a.id, {
      systemPrompt: 'be brief',
      toolPolicy: { requireApproval: false },
      budget: { maxTurns: 3 },
    });
    const view = t.store.get('default', a.id)!;
    expect(view.systemPrompt).toBe('be brief');
    expect(view.budget.maxTurns).toBe(3);
    expect(view.toolPolicy.requireApproval).toBe(false);
    const bound = t.store.bind('default', a.id, 'webhook', 'acc1');
    expect(bound.bindings).toContainEqual({ channelType: 'webhook', accountId: 'acc1' });
    const unbound = t.store.unbind('default', a.id, 'webhook', 'acc1');
    expect(unbound.bindings).toHaveLength(0);
  });

  it('keeps a single default per workspace', () => {
    const t = agents();
    const a = t.store.create('default', 'A');
    t.store.setDefault('default', a.id);
    expect(t.store.list('default').filter(x => x.isDefault)).toHaveLength(1);
    expect(t.store.getDefault('default')?.id).toBe(a.id);
  });

  it('resolves agent id falling back to default and scopes by workspace', () => {
    const t = agents();
    expect(t.store.resolveAgentId('default', undefined)).toBe('main');
    expect(() => t.store.resolveAgentId('missing', 'nope')).toThrow(/No agent is configured/i);
  });
});

function skillSetup() {
  const dataDir = tempDir();
  const db = new CoreDatabase(join(dataDir, 'c.sqlite'));
  const bundled = join(dataDir, 'bundled-skills');
  mkdirSync(join(bundled, 'summarizer'), { recursive: true });
  writeFileSync(
    join(bundled, 'summarizer', 'SKILL.md'),
    `---\nname: Summarizer\nversion: 1.0.0\ndescription: Summarizes text\ntools:\n  - core.time.getCurrentTime\n---\n# Summarizer\nAlways produce a concise summary.`,
  );
  const skills = new CoreSkillStore(db, dataDir, bundled);
  return { dataDir, db, bundled, skills };
}

describe('CoreSkillStore local library', () => {
  it('reads bundled skills with parsed manifest, enabled by default', () => {
    const t = skillSetup();
    const s = t.skills.get('default', 'summarizer')!;
    expect(s.name).toBe('Summarizer');
    expect(s.source).toBe('bundled');
    expect(s.enabled).toBe(true);
    expect(t.skills.enabledInstructions('default')[0]?.instruction).toContain('concise summary');
  });

  it('persists enablement/config per workspace', () => {
    const t = skillSetup();
    const disabled = t.skills.setEnabled('default', 'summarizer', false);
    expect(disabled.enabled).toBe(false);
    const configured = t.skills.configure('default', 'summarizer', { tone: 'formal' });
    expect(configured.config).toEqual({ tone: 'formal' });
    // independent workspace
    expect(t.skills.get('other', 'summarizer')?.enabled).toBe(true);
  });

  it('refuses to uninstall a bundled skill', () => {
    const t = skillSetup();
    expect(() => t.skills.uninstall('default', 'summarizer')).toThrow(/disabled/i);
  });

  it('rejects a skill directory containing an escaping symlink', () => {
    const t = skillSetup();
    const src = join(t.dataDir, 'evil-skill');
    mkdirSync(join(src), { recursive: true });
    mkdirSync(join(src, 'escape-target'), { recursive: true });
    writeFileSync(join(src, 'SKILL.md'), `---\nname: Evil\n---\n# Evil\nbody`);
    try { symlinkSync('/etc', join(src, 'escape-target', 'passwd')); } catch { /* may need privilege */ }
    expect(() => t.skills.installFromPath('default', src)).toThrow(CoreError);
  });

  it('copies a valid local skill and can uninstall it', () => {
    const t = skillSetup();
    const src = join(t.dataDir, 'my-skill');
    mkdirSync(src, { recursive: true });
    writeFileSync(src + '/SKILL.md', `---\nname: My Skill\nversion: 0.1.0\ndescription: mine\n---\n# My\nDo the thing.`);
    const installed = t.skills.installFromPath('default', src);
    expect(installed.source).toBe('local');
    expect(installed.installedOnDisk).toBe(true);
    t.skills.uninstall('default', 'my-skill');
    expect(t.skills.get('default', 'my-skill')).toBeUndefined();
  });
});
