/** Reviewed internal references: invocation flags alone never imply a broken Skill. */
export const BUNDLED_INTERNAL_SKILL_ENTRIES: Readonly<Record<string, string>> = {
  'ardot-design-core': 'design-router',
  'ardot-design-to-code': 'design-router',
  'ardot-poster': 'design-router',
  'ardot-slides': 'design-router',
  'ardot-ui-design': 'design-router',
  'component-instance': 'design-router',
  'design-variables': 'design-router',
  'livestream-poster': 'design-router',
  'miora-brand-design': 'design-router',
  'miora-creative-core': 'design-router',
  'miora-image-generation': 'design-router',
  'miora-video-generation': 'design-router',
  'shared-styles': 'design-router',
  'design-token': 'tencent-docx',
  'doc-typeset': 'tencent-docx',
  'format-extract': 'tencent-docx',
  'generate-fillable-contract-html': 'tencent-docx',
  'html-review': 'tencent-docx',
  'html-to-docx': 'tencent-docx',
  'tdoc-orchestrator': 'tencent-docx',
}

/** Do not reclassify custom overrides or silently change their invocation policy. */
export function internalSkillEntry(skill: { name: string; source: string; modelInvocable: boolean; userInvocable: boolean }): string | undefined {
  if (skill.source !== 'bundled' || skill.modelInvocable || skill.userInvocable) return undefined
  return Object.hasOwn(BUNDLED_INTERNAL_SKILL_ENTRIES, skill.name) ? BUNDLED_INTERNAL_SKILL_ENTRIES[skill.name] : undefined
}
