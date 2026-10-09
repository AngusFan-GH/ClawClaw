import { z } from 'zod'
import { TEAM_PROMPTS_EN } from './team-prompts-en.js'
import { TEAM_PROMPTS } from './team-prompts.js'
export { TEAM_PROMPTS }
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => Array.from(value).length <= max)
export const TEAM_CUSTOM_ID =
  /^team-custom-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
export const teamMemberSchema = z
  .object({ expertSlug: text(128), duty: text(100), instructions: text(2000) })
  .strict()
export const teamInputSchema = z
  .object({
    id: z
      .string()
      .regex(/^team-(?:[a-z]+|custom-[0-9a-f-]+)$/u)
      .optional(),
    builtin: z.boolean().optional(),
    name: text(40).refine((value) => !/[@\r\n\u0000-\u001f]/u.test(value)),
    description: text(160),
    tags: z.array(text(16)).max(3),
    goal: text(2000),
    constraints: z.string().trim().max(2000),
    deliveryRequirements: text(2000),
    members: z
      .array(teamMemberSchema)
      .min(2)
      .max(8)
      .refine(
        (items) =>
          new Set(items.map((item) => item.expertSlug)).size === items.length,
      ),
    examples: z.array(text(1000)).min(1).max(3),
    coordinatorMode: z.enum(['template', 'custom']),
    coordinatorTemplateId: z.enum([
      'general',
      'product',
      'technical',
      'content',
      'data',
      'research',
    ]),
    coordinatorTemplateVersion: z.literal(1),
    coordinatorPrompt: z
      .string()
      .refine((value) => Array.from(value).length <= 12000),
  })
  .strict()
  .refine(
    (value) =>
      value.coordinatorMode !== 'custom' ||
      value.coordinatorPrompt.trim().length > 0,
  )
export type TeamInput = z.infer<typeof teamInputSchema>
export type ExpertTeam = TeamInput & { id: string; builtin: boolean }
export const teamSchema = teamInputSchema.and(
  z.object({ id: z.string(), builtin: z.boolean() }),
)
export const teamEngineStatusSchema = z.object({
  state: z.enum(['unsupported', 'disabled', 'enabled']),
  mode: z.enum(['subagent', 'native']),
  reason: z.string(),
  recommendation: z.string(),
})
export type TeamEngineStatus = z.infer<typeof teamEngineStatusSchema>
export const teamSnapshotSchema = z.object({
  teams: z.array(teamSchema),
  enabledTeams: z.array(z.string()),
  enabledExperts: z.array(z.string()),
  revision: z.number().int().min(0),
  engine: teamEngineStatusSchema.optional(),
  nativeMembers: z.record(z.string(), z.string()).optional(),
})
export type TeamSnapshot = z.infer<typeof teamSnapshotSchema>
export const effectiveCoordinator = (team: TeamInput, locale: 'zh' | 'en' = 'zh'): string =>
  team.coordinatorMode === 'custom'
    ? team.coordinatorPrompt
    : (locale === 'en' ? TEAM_PROMPTS_EN : TEAM_PROMPTS)[team.coordinatorTemplateId]
const member = (expertSlug: string, duty: string, instructions: string) => ({
  expertSlug,
  duty,
  instructions,
})
const TEAM_DESCRIPTIONS = {
  product: '适合需求评审、方案比较与迭代规划。结合用户价值、使用体验和实现成本，明确首版范围、功能优先级及下一步行动。',
  technical: '适合架构设计评审与交付前检查。从架构、安全和质量三个角度定位风险，给出最小修改建议与可执行的验收清单。',
  content: '适合选题规划与内容方向筛选。结合受众需求、平台传播特点和素材依据，提出选题、标题与大纲，标明需要补充的事实材料。',
  data: '适合指标复盘、异常排查与报表分析。先核对数据质量和统计口径，再解释业务变化，给出分析结论、图表方案及待验证问题。',
  research: '适合专题调研、趋势判断与方案决策。梳理可信来源、变化因素和不同方案的利弊，形成有依据的建议，并说明争议与适用条件。',
  delivery: '适合从需求澄清到上线验收的软件交付。按产品范围、技术方案、实现质量和测试证据组织工作，形成可执行的交付计划。',
  design: '适合产品体验和界面方案的联合评审。从用户任务、交互结构、视觉完成度和实现约束定位问题，形成按优先级排列的改进清单。',
  hr: '适合招聘、入职、绩效和组织协作等人力运营工作。统一岗位要求、候选人证据、员工体验和合规边界，避免各环节相互脱节。',
  campaign: '适合完整营销活动的策划、投放和复盘。统一受众、核心信息、内容资产、渠道组合及指标口径，明确上线前的事实与品牌检查。',
  sales: '适合从线索筛选到成交推进的销售协作。结合客户研究、需求发现、方案匹配、管道健康和交易风险，形成明确的下一步行动。',
  legal: '适合企业合同、政策和数据处理事项的初步联合审查。按义务、责任、隐私和执行风险整理问题，并标出需要专业律师判断的事项。',
  finance: '适合经营分析、预算预测、税务和异常交易检查。统一数据口径和会计假设，区分经营判断、合规风险及仍需核验的凭证。',
  operations: '适合跨部门流程设计和运营改进。明确目标、负责人、交接、自动化边界和控制点，形成可跟踪的行动与复盘机制。',
} satisfies Record<string, string>
const TEAM_TEMPLATES: Readonly<Record<keyof typeof TEAM_DESCRIPTIONS, TeamInput['coordinatorTemplateId']>> = {
  product: 'product', technical: 'technical', content: 'content', data: 'data', research: 'research',
  delivery: 'technical', design: 'product', hr: 'general', campaign: 'content', sales: 'general',
  legal: 'research', finance: 'data', operations: 'general',
}
const define = (
  id: keyof typeof TEAM_DESCRIPTIONS,
  name: string,
  goal: string,
  tags: string[],
  members: TeamInput['members'],
  deliveryRequirements: string,
  examples: string[],
): ExpertTeam => ({
  id: `team-${id}`,
  builtin: true,
  name,
  description: TEAM_DESCRIPTIONS[id],
  tags,
  members,
  goal,
  constraints: '仅进行分析评审；依据不足时明确说明，不擅自修改或发布。',
  deliveryRequirements,
  examples,
  coordinatorMode: 'template',
  coordinatorTemplateId: TEAM_TEMPLATES[id],
  coordinatorTemplateVersion: 1,
  coordinatorPrompt: '',
})
export const BUILTIN_TEAMS: readonly ExpertTeam[] = [
  define(
    'product',
    '产品方案评审团',
    '从价值、体验和可行性评估产品方案。',
    ['需求评审', '方案比较', '迭代规划'],
    [
      member(
        'product-manager',
        '需求价值与优先级',
        '检查目标用户、核心问题和需求范围，按同一需求项列出必须做、建议做和暂缓事项、价值依据及成功指标。区分反馈与假设；将体验证据缺口交给主理人对照研究意见，将成本未知项对照架构意见，不代替队友判断。',
      ),
      member(
        'design-ux-researcher',
        '用户需求与体验障碍',
        '按用户完成任务的实际步骤定位体验障碍，说明受影响人群、已有反馈及未经验证的假设。为每个障碍给出低成本验证方法和验收信号；将影响需求优先级的问题交接给主理人，不替代产品排期和技术估算。',
      ),
      member(
        'engineering-software-architect',
        '实现成本与技术约束',
        '按需求项分析实现范围、已有能力、外部依赖和技术约束，提出最小交付路径及备选方案。说明成本判断依据与未知项，不编造工期；交接可能改变需求范围或用户流程的技术限制。',
      ),
    ],
    '优先级与行动清单',
    [
      '评估这份需求，明确首版必须做和可以暂缓的功能。',
      '比较两个产品方案，给出价值、体验和成本上的取舍。',
      '根据现有功能和用户反馈，制定下一阶段迭代计划。',
    ],
  ),
  define(
    'technical',
    '技术方案评审团',
    '检查架构、安全风险与验收边界。',
    ['架构评审', '安全风险', '交付验收'],
    [
      member(
        'engineering-software-architect',
        '架构与扩展性',
        '沿组件、接口和数据流检查职责边界、依赖、兼容性及可维护性。每个发现给出位置、触发条件、影响和最小修改方案；标记需主理人对照安全意见与回归用例的变更点，不宣称未执行的测试通过。',
      ),
      member(
        'security-appsec-engineer',
        '权限与安全风险',
        '沿输入入口、权限检查和敏感数据流识别风险，给出位置、攻击前提、影响及最小修复建议。区分已验证漏洞、设计风险和材料缺口；交接应阻断放行的条件及需要质量角色覆盖的验证场景。',
      ),
      member(
        'testing-reality-checker',
        '验收边界与质量',
        '依据现有方案独立列出正常、异常、边界、兼容与回滚场景，逐项写明前置条件、操作和预期结果。区分实际执行结果与建议用例；交接需主理人结合架构和安全发现补充的覆盖点，不假设已经拿到队友报告。',
      ),
    ],
    '风险与验收清单',
    [
      '评审这份技术方案，指出阻断交付的风险及最小修改建议。',
      '检查接口与权限设计，列出需要补充的验证。',
      '为这次改动制定清晰、可执行的验收清单。',
    ],
  ),
  define(
    'content',
    '内容选题策划团',
    '找到值得写、适合传播的内容方向。',
    ['内容策划', '传播策略', '事实核验'],
    [
      member(
        'marketing-content-creator',
        '选题角度与表达',
        '围绕同一主题及已提供的候选方向，按目标受众价值提出有区分度的选题、标题、大纲和开头。每个核心论点关联已有素材或标记待补；交接需核实的事实及需要传播意见确认的平台表达，不编造案例。',
      ),
      member(
        'marketing-growth-hacker',
        '人群与传播策略',
        '围绕已提供的主题或候选方向分析目标人群、平台使用场景、点击与分享动机，给出包装建议和可观察指标。说明推荐依据及平台限制，不承诺流量；将夸大标题或素材不足的风险交给主理人核对。',
      ),
      member(
        'research-synthesist',
        '素材依据与事实缺口',
        '为已提供主题、素材及核心论点建立事实—出处对应表，检查来源、日期、引用语境和可用范围。区分已支持、待核实与不宜使用的论点，列出补证方向；没有收到创作结果时不要声称已核验其新标题或大纲。',
      ),
    ],
    '选题与内容大纲',
    [
      '根据账号定位和已有素材，提出三个值得写的选题。',
      '评估这些内容方向，按受众价值和素材可用性排序。',
      '把这个主题拆成适合目标平台的内容大纲，标明待补素材。',
    ],
  ),
  define(
    'data',
    '数据分析诊断团',
    '核对数据口径，发现问题并解释结果。',
    ['数据质量', '业务分析', '图表表达'],
    [
      member(
        'engineering-data-engineer',
        '数据质量与统计口径',
        '检查字段、时间窗口、单位、样本、缺失值、重复记录和指标分母，输出可供主理人核对的口径表及质量问题。说明问题对哪些指标有影响、哪些比较不能成立；材料不足时列出所需字段，不虚构清洗或查询结果。',
      ),
      member(
        'support-analytics-reporter',
        '业务指标与异常',
        '围绕业务问题分析指标与异常，每个关键数值附数据来源、时间、单位、分母及计算方式。明确质量假设和替代解释，不把相关性当因果性；交接需主理人对照质量报告确认的口径，未核实前使用条件性结论。',
      ),
      member(
        'engineering-data-visualization-engineer',
        '图表与结果表达',
        '依据实际可用字段与业务问题提出图表方案，明确横纵轴、单位、聚合方式、对比基准和必要标注。说明可能误读的尺度或样本问题；未收到已核验数值时只提供方案，不编造图表数据，将口径依赖交接给主理人。',
      ),
    ],
    '分析结论与图表建议',
    [
      '分析这份数据，先核对口径，再解释主要异常。',
      '比较这两期业务指标，区分真实变化与统计口径差异。',
      '根据这些字段提出图表方案，并说明能支持哪些结论。',
    ],
  ),
  define(
    'research',
    '专题研究专家团',
    '梳理证据、趋势与不同方案的取舍。',
    ['证据梳理', '趋势分析', '方案比较'],
    [
      member(
        'research-synthesist',
        '证据可信度与来源',
        '围绕研究问题建立论点—来源—日期—适用范围证据表，优先一手资料，区分同源转述和独立来源。指出冲突、过时信息与尚无依据的判断；交接趋势或方案比较应遵守的证据边界，无法检索时明确资料范围。',
      ),
      member(
        'product-trend-researcher',
        '变化与驱动因素',
        '分析指定时间与地区内的变化方向、驱动因素和替代解释，区分事实、趋势推断及情景假设。每项判断关联证据并给出反证或失效条件；交接需要主理人核查的时效和口径，不凭同源重复报道增强确信。',
      ),
      member(
        'specialized-strategy-duel-agent',
        '竞争方案与取舍',
        '基于用户决策目标使用一致维度比较备选方案，说明适用条件、收益、成本、风险及可逆性。给出推荐及可能推翻它的证据，不编造精确评分；将关键假设交接给主理人对照来源与趋势意见。',
      ),
    ],
    '研究结论与证据来源',
    [
      '围绕这个问题整理可信证据，说明可以确认和仍有争议的内容。',
      '比较这些解决方案，给出适用条件与取舍建议。',
      '分析这个领域的趋势、驱动因素及可能推翻判断的反证。',
    ],
  ),
  define(
    'delivery',
    '软件交付专家团',
    '把软件需求转化为可实施、可验证、可上线的交付方案。',
    ['需求到上线', '工程协作', '质量验收'],
    [
      member('product-manager', '需求范围与验收目标', '澄清用户问题、首版范围、优先级和成功指标。列出会改变排期或方案的未知项，保持需求编号稳定，供架构、实现和测试角色引用。'),
      member('engineering-software-architect', '架构与任务拆分', '基于已确认范围设计模块边界、接口、数据流和迁移路径，标明依赖、兼容性和回滚策略。把每项技术决策关联到需求与验收条件。'),
      member('engineering-minimal-change-engineer', '最小实现路径', '检查现有代码和约定，给出影响面最小的实现顺序、修改位置和验证方式。区分必须修改与可延后优化，不假设未查看的代码行为。'),
      member('testing-test-automation-engineer', '自动化验证', '按需求和技术风险设计单元、集成与关键流程测试，说明前置条件、数据、步骤和预期结果。标出仍需人工验证或真实环境验证的部分。'),
    ],
    '交付范围、实施顺序、风险与验收矩阵',
    ['把这份需求整理成可直接进入开发的交付计划。', '评估当前实现方案能否按期上线，并列出阻断项。', '为这次版本制定从开发到发布的完整验收方案。'],
  ),
  define(
    'design',
    '体验设计评审团',
    '从用户任务、交互结构、视觉质量和技术可行性评审体验方案。',
    ['用户体验', '交互评审', '设计验收'],
    [
      member('design-ux-researcher', '用户证据与任务路径', '依据已有研究、反馈和使用场景描述目标用户及关键任务，区分证据和假设，定位最需要验证的体验障碍。'),
      member('design-ux-architect', '信息架构与交互结构', '检查导航、信息层级、流程分支、状态反馈和跨页面一致性，为每个结构问题给出可执行调整及受影响页面。'),
      member('design-ui-finish-gate-reviewer', '视觉完成度与可访问性', '检查排版、间距、颜色、组件状态、响应式布局和可访问性，按阻断、重要、建议分级，不用主观偏好替代设计依据。'),
      member('engineering-rapid-prototyper', '实现可行性与原型', '从现有技术栈和组件能力评估实现复杂度，提出能验证核心交互的最小原型范围以及需要真实设备检查的部分。'),
    ],
    '按优先级排列的体验问题、修改方案与验证计划',
    ['评审这套页面流程，找出阻碍用户完成任务的问题。', '比较两个交互方案并给出推荐与验证方法。', '为上线前的设计验收制定检查清单。'],
  ),
  define(
    'hr',
    '人力运营专家团',
    '贯通岗位设计、招聘评估、入职融入和绩效改进。',
    ['人才招聘', '员工体验', '绩效发展'],
    [
      member('hr-recruiter', '岗位与招聘流程', '把业务需求转为岗位成果、必备能力和可培养能力，设计来源、筛选和面试流程，避免使用与岗位无关的评价标准。'),
      member('recruitment-specialist', '候选人证据评估', '建立统一评分维度和证据要求，区分履历陈述、面试观察和待核实事项，指出偏差风险及需要补充的背景核验。'),
      member('hr-onboarding', '入职与角色融入', '设计首日、首周和阶段性入职路径，明确资料、权限、导师、学习任务和成功信号，并列出跨部门依赖。'),
      member('hr-performance-reviewer', '绩效与发展机制', '将岗位成果转化为可观察目标、反馈节奏和发展计划，区分结果、行为与环境因素，不代替管理者作未经证实的人员判断。'),
      member('organizational-psychologist', '组织协作与心理风险', '检查角色清晰度、工作负荷、团队安全感和激励机制，提出可验证的组织干预，标明隐私、劳动关系和专业咨询边界。'),
    ],
    '人才流程、责任人、评估证据和阶段性检查点',
    ['设计一个从招聘到入职三个月的完整人才流程。', '检查现有绩效方案是否公平、可执行。', '分析团队协作问题并提出可验证的改进计划。'],
  ),
  define(
    'campaign',
    '营销活动专家团',
    '完成从受众洞察、内容创意到渠道投放和效果复盘的营销活动方案。',
    ['营销策划', '内容与投放', '效果复盘'],
    [
      member('marketing-growth-hacker', '增长目标与受众', '明确目标人群、转化路径、增长假设和可观察指标，指出样本、归因及平台限制，不承诺未经验证的增长结果。'),
      member('marketing-content-creator', '核心信息与内容资产', '建立统一信息主线，产出活动主题、内容结构和渠道改写规则，所有事实性卖点关联证据或标记待核实。'),
      member('paid-media-creative-strategist', '广告创意与测试', '设计创意角度、素材规格、变量控制和停止条件，确保比较能回答明确假设，不编造平台审核结论或预期点击率。'),
      member('paid-media-tracking-specialist', '追踪与归因', '检查事件、参数、转化窗口、去重和隐私要求，形成上线前追踪清单及数据异常排查顺序。'),
      member('marketing-pr-communications-manager', '品牌与舆情风险', '检查对外表述、利益相关方、响应口径和潜在误解，列出需要法务、品牌或管理层批准的内容。'),
    ],
    '活动简报、渠道计划、内容清单、指标口径和上线门槛',
    ['为新品发布设计一套跨渠道营销活动。', '诊断这次活动效果不佳的原因并提出下一轮实验。', '检查活动素材、投放和数据追踪是否已经具备上线条件。'],
  ),
  define(
    'sales',
    '销售作战专家团',
    '从客户研究、需求发现、方案匹配到交易推进形成一致销售策略。',
    ['客户洞察', '方案销售', '管道推进'],
    [
      member('sales-account-strategist', '客户与利益相关方', '整理客户目标、组织关系、决策流程、竞争态势和已知风险，区分事实与销售假设，明确下一步需要验证的信息。'),
      member('sales-discovery-coach', '需求发现与证据', '把访谈内容转为业务问题、影响、优先级和成功标准，设计后续问题，避免在证据不足时直接跳到产品方案。'),
      member('sales-engineer', '解决方案与技术适配', '将已确认需求映射到能力、集成、数据、安全和实施条件，清楚列出满足、部分满足、待验证和不支持事项。'),
      member('sales-pipeline-analyst', '管道健康与预测', '核对阶段定义、成交条件、时间、金额和下一步承诺，识别停滞与虚假进展，不用主观信心代替客户证据。'),
      member('sales-deal-strategist', '交易策略与风险', '综合价值、竞争、采购、法务和实施风险，给出推进路径、谈判边界及退出条件，不擅自承诺价格或合同条款。'),
    ],
    '客户证据、方案差距、交易风险和带责任人的下一步行动',
    ['为这个重点客户制定账户策略和推进计划。', '复盘一次需求访谈，找出缺失证据和下一轮问题。', '评估当前销售管道并找出最需要干预的机会。'],
  ),
  define(
    'legal',
    '企业法务评审团',
    '对合同、政策和数据处理事项进行结构化初审并识别升级点。',
    ['合同审查', '隐私合规', '政策治理'],
    [
      member('legal-contract-reviewer', '合同义务与责任', '按主体、范围、付款、交付、保证、责任、终止和争议条款建立问题表，引用具体条款并区分缺失、歧义和不可接受风险。'),
      member('data-privacy-officer', '个人信息与数据治理', '检查数据类别、目的、授权基础、共享、跨境、保留、主体权利和事件响应，明确适用范围与待确认法域。'),
      member('legal-policy-writer', '制度与政策可执行性', '检查政策目标、适用对象、职责、流程、例外、记录和版本治理，确保规定能够被执行和审计。'),
      member('support-legal-compliance-checker', '合规证据与升级边界', '把发现映射到现有证据、控制和责任人，区分一般改进、潜在违规和必须交由持证律师判断的事项。'),
    ],
    '条款或要求、风险等级、证据、建议修改和专业升级点',
    ['初审这份服务合同并列出谈判重点。', '评估这个数据处理流程的隐私风险。', '检查公司政策是否完整、可执行并便于审计。'],
  ),
  define(
    'finance',
    '财务经营分析团',
    '结合账务、预测、税务和异常检查形成可追溯的经营判断。',
    ['经营分析', '预算预测', '财税风险'],
    [
      member('finance-bookkeeper-controller', '账务口径与凭证', '检查科目、期间、权责发生、对账和凭证完整性，说明哪些数字可直接使用、哪些需要调整或补证。'),
      member('finance-fpa-analyst', '预算与经营驱动', '将收入、成本、现金和业务驱动因素建立对应关系，比较预算、实际和预测，解释差异且保留计算依据。'),
      member('finance-financial-forecaster', '预测与情景', '建立基准、乐观和压力情景，明确假设、敏感变量和失效条件，不用单一精确数字掩盖不确定性。'),
      member('finance-tax-strategist', '税务与申报风险', '识别交易结构、税种、期间、凭证和法域问题，区分一般信息与需要当地税务专业人士确认的判断。'),
      member('finance-fraud-detector', '异常交易与控制', '按金额、频率、对手方、审批、权限和行为模式识别异常，保留证据链，不把异常直接认定为舞弊。'),
    ],
    '经营结论、计算口径、情景预测、异常事项和待补凭证',
    ['分析本月经营结果并解释预算差异。', '为未来两个季度建立现金流情景预测。', '检查这批交易的税务和异常风险。'],
  ),
  define(
    'operations',
    '运营流程优化团',
    '把跨部门业务流程转化为明确、可控、可持续改进的运行机制。',
    ['流程设计', '自动化治理', '运营改进'],
    [
      member('operations-manager', '目标与运营机制', '明确服务对象、目标、容量、服务水平、负责人和复盘节奏，定位影响交付的资源与协作约束。'),
      member('specialized-workflow-architect', '流程与交接设计', '绘制输入、步骤、决策、交接、输出和异常路径，识别重复录入、等待、返工及责任空白。'),
      member('automation-governance-architect', '自动化与控制边界', '判断哪些步骤适合自动化，设计权限、审批、可观察性、失败恢复和人工接管，避免把错误流程直接自动化。'),
      member('project-management-project-shepherd', '行动跟踪与依赖', '把改进方案转为负责人、里程碑、依赖、完成证据和升级条件，保持状态可追踪且不虚构进度。'),
    ],
    '现状流程、目标流程、责任矩阵、控制点和分阶段改进计划',
    ['梳理这条跨部门流程并找出等待和返工原因。', '评估哪些环节适合自动化以及需要哪些控制。', '把运营改进方案拆成可跟踪的实施计划。'],
  ),
]
