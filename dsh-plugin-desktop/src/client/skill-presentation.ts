/** Presentation-only categories; Skill identities and discovery remain unchanged. */
export const SKILL_CATEGORIES = ['all', 'productivity', 'content', 'data', 'business', 'office', 'learning', 'development', 'finance', 'design', 'compliance'] as const
export type SkillCategory = typeof SKILL_CATEGORIES[number]
export type SkillPurpose = Exclude<SkillCategory, 'all'>
export type SkillCategoryKey = `category${Capitalize<SkillCategory>}`
export const skillCategoryKey = (category: SkillCategory): SkillCategoryKey => `category${category[0]!.toUpperCase()}${category.slice(1)}` as SkillCategoryKey

/** Reviewed by primary deliverable, with exactly one category per bundled Skill. */
export const BUNDLED_SKILL_CATEGORIES: Readonly<Record<SkillPurpose, readonly string[]>> = {
  productivity: ['expert-manager', 'marketplace-skill-installer', 'recommend-connectors', 'recommend-experts', 'skill-creator'],
  content: ['brief-compose', 'business-copy-expert', 'content-production', 'general-writer', 'poetry-prose-expert', 'science-writing-expert', 'tech-blog-expert'],
  data: ['business-data-analysis', 'clawclaw-smartsheet', 'data-analysis', 'enterprise-data-query', 'tencent-docs-sheet-generation', 'tencent-docs-sheetagent'],
  business: ['business-operations', 'weixinpay-feedback', 'weixinpay-pay', 'weixinpay-register'],
  office: ['office-word-workflow', 'office-ppt-workflow', 'office-excel-workflow', 'office-pdf-workflow', 'office-meeting-minutes', 'office-email-drafting', 'office-document-comparison', 'office-document-translation', 'calendar-management', 'design-token', 'doc-typeset', 'enterprise-office-assistant', 'format-extract', 'html-review', 'html-to-docx', 'tdoc-orchestrator', 'tencent-docs', 'tencent-docs-routing', 'tencent-docx', 'tencent-local-office-edit', 'tencent-pptx', 'tencent-saas-docs', 'wecom-forwarded-chat-resources', 'work-report-expert'],
  learning: ['academic-paper-expert', 'evidence-research', 'library'],
  development: ['ardot-design-to-code', 'cloud-service', 'sites', 'software-delivery'],
  finance: ['clawclaw-finance-skill', 'stock-research-report-expert'],
  design: ['ardot-design-core', 'ardot-poster', 'ardot-slides', 'ardot-ui-design', 'buddy-image-processing', 'buddy-multimodal-generation', 'component-instance', 'design-router', 'design-variables', 'livestream-poster', 'miora-brand-design', 'miora-creative-core', 'miora-image-generation', 'miora-video-generation', 'product-design-review', 'shared-styles'],
  compliance: ['generate-fillable-contract-html', 'geo-map-compliance-guard', 'legal-contract-expert', 'risk-compliance-review'],
}

const bundledCategories = new Map(Object.entries(BUNDLED_SKILL_CATEGORIES).flatMap(([category, names]) => names.map(name => [name, category as SkillPurpose] as const)))

// Fallback for imported/custom Skills, whose identifiers need not follow our catalog.
const CATEGORY_RULES: readonly [Exclude<SkillPurpose, 'productivity'>, RegExp][] = [
  ['compliance', /(?:legal|contract|compliance|privacy|法务|合同|合规|隐私)/iu],
  ['business', /(?:weixinpay|payment|支付)/iu],
  ['finance', /(?:finance|financial|stock|investment|投资|证券|金融)/iu],
  ['data', /(?:data-analysis|business-data|data-query|sheet|excel|csv|analytics|database)/iu],
  ['office', /(?:office|tencent-doc|tdoc|docx|doc-typeset|html-to-docx|work-report|calendar|wecom|legal-contract|contract-html)/iu],
  ['design', /(?:design|ardot|miora|poster|image|video|pptx|slides|geo-map)/iu],
  ['development', /(?:software|code|frontend|developer|html-review|component|cloud-service|sites)/iu],
  ['learning', /(?:research|academic|science|evidence|knowledge)/iu],
  ['business', /(?:business-operations|sales|marketing|operations|hr-|customer)/iu],
  ['content', /(?:writ|content|compose|copy|poetry|prose|blog|translat)/iu],
]

export function skillCategory(name: string): SkillPurpose {
  return bundledCategories.get(name) ?? CATEGORY_RULES.find(([, pattern]) => pattern.test(name))?.[0] ?? 'productivity'
}
