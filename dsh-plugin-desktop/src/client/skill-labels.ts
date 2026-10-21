/** User-facing labels for bundled capabilities; identifiers stay stable. */
import type { DesktopSkillView } from '../skills-contract.ts'
export const OFFICE_WORKFLOW_ORDER = ['office-word-workflow', 'office-ppt-workflow', 'office-excel-workflow', 'office-pdf-workflow', 'office-meeting-minutes', 'office-email-drafting', 'office-document-comparison', 'office-document-translation'] as const

export function skillDisplayOrder(name: string): number {
  const index = OFFICE_WORKFLOW_ORDER.indexOf(name as typeof OFFICE_WORKFLOW_ORDER[number])
  return index < 0 ? OFFICE_WORKFLOW_ORDER.length : index
}
export const BUNDLED_SKILL_PRESENTATION: Readonly<Record<string, readonly [string, string, string]>> = {
  "academic-paper-expert": [
    "学术论文写作",
    "Academic writing",
    "撰写论文、文献综述与摘要，规范引文和学术表达。"
  ],
  "ardot-design-core": [
    "画布设计基础",
    "Canvas design foundations",
    "统一画布设计规范，支持界面、海报及演示稿设计。"
  ],
  "ardot-design-to-code": [
    "设计稿转前端代码",
    "Design to code",
    "将画布设计转成前端代码，提取组件和样式规范。"
  ],
  "ardot-poster": [
    "宣传海报设计",
    "Poster design",
    "设计活动、宣传及营销海报，组织文案和视觉版式。"
  ],
  "ardot-slides": [
    "演示稿视觉设计",
    "Presentation canvas design",
    "设计演示稿画布和逐页视觉方案，区别于PPTX文件制作。"
  ],
  "ardot-ui-design": [
    "网页与应用界面设计",
    "Interface design",
    "设计网页和应用界面，梳理布局、组件与交互状态。"
  ],
  "brief-compose": [
    "短文与通知快写",
    "Short-form writing",
    "快速撰写短篇通知、说明及简短文稿，并按需生成文档。"
  ],
  "buddy-image-processing": [
    "图片修复与处理",
    "Image editing and restoration",
    "修复、增强已有图片，处理水印、文字和人像细节。"
  ],
  "buddy-multimodal-generation": [
    "三维与视频特效",
    "3D and video effects",
    "生成三维模型，或使用模板将图片转为视频效果。"
  ],
  "business-copy-expert": [
    "营销与商业文案",
    "Marketing copywriting",
    "撰写产品介绍、推广邮件、广告语与品牌文案。"
  ],
  "business-data-analysis": [
    "经营数据分析与报告",
    "Business data analysis",
    "清洗对账、计算经营指标和同比环比，生成可复算分析报告。"
  ],
  "business-operations": [
    "业务流程与运营规划",
    "Business operations",
    "梳理运营目标、流程分工、行动计划和复盘指标。"
  ],
  "calendar-management": [
    "日程安排与会议跟进",
    "Calendar and meeting follow-up",
    "安排日程、准备会议并跟踪会后事项，需要可用日历连接。"
  ],
  "clawclaw-finance-skill": [
    "金融投资研究",
    "Finance and investment research",
    "分析股票、基金、财报、估值及市场数据，说明依据与风险。"
  ],
  "clawclaw-smartsheet": [
    "智能表与业务台账",
    "Smart tables and trackers",
    "创建智能表、管理记录与公式，制作业务视图和看板。"
  ],
  "cloud-service": [
    "应用后端与云服务",
    "App backends and cloud services",
    "为应用配置数据存储、认证及文件服务，需相应服务可用。"
  ],
  "component-instance": [
    "设计组件与变体管理",
    "Design components and variants",
    "创建和修改画布组件实例，配置属性与设计变体。"
  ],
  "content-production": [
    "文章与多平台内容",
    "Editorial content production",
    "规划并撰写文章、社媒内容和脚本，适配受众及渠道。"
  ],
  "data-analysis": [
    "数据统计与图表分析",
    "Data analysis and charts",
    "检查数据质量，计算指标、识别异常并选择合适图表。"
  ],
  "design-router": [
    "设计任务助手",
    "Design task assistant",
    "识别设计交付物，选择界面、海报或创意生成工作流。"
  ],
  "design-token": [
    "文档主题与排版规范",
    "Document themes and layout rules",
    "按公文、论文或报告选择字体、颜色、间距和版式规则。"
  ],
  "design-variables": [
    "设计变量与主题管理",
    "Design variables and themes",
    "管理画布设计变量，绑定组件属性并切换主题模式。"
  ],
  "doc-typeset": [
    "文档排版与美化",
    "Document typesetting",
    "根据内容和主题规范，排版报告、论文、公文和合同。"
  ],
  "enterprise-data-query": [
    "企业数据查询",
    "Enterprise data queries",
    "通过已授权的数据连接查询业务数据，保留口径和来源。"
  ],
  "enterprise-office-assistant": [
    "日常办公综合助手",
    "Everyday office assistant",
    "协助写作、摘要、Word、PPT、Excel与资料检索，按任务选择技能。"
  ],
  "evidence-research": [
    "资料检索与证据核查",
    "Research and evidence checks",
    "围绕问题检索资料，核对来源、分歧和证据缺口。"
  ],
  "expert-manager": [
    "专家创建与维护",
    "Expert creation and maintenance",
    "创建、修改和检查专家包，维护专家信息与工作流程。"
  ],
  "format-extract": [
    "Word结构与格式提取",
    "Word structure extraction",
    "提取Word标题、段落、表格与图片，支持格式分析。"
  ],
  "general-writer": [
    "通用文稿撰写与润色",
    "General writing and editing",
    "撰写和润色方案、邮件、文案及常用文稿，调整结构与语气。"
  ],
  "generate-fillable-contract-html": [
    "合同与报价模板",
    "Fillable contract templates",
    "生成可填写的合同、报价单与授权委托书模板。"
  ],
  "geo-map-compliance-guard": [
    "地图内容合规检查",
    "Map compliance checks",
    "检查地图展示、地理信息与位置服务涉及的合规要求。"
  ],
  "html-review": [
    "文档排版质量检查",
    "Document layout review",
    "检查文档HTML的结构、主题规范和版面质量。"
  ],
  "html-to-docx": [
    "HTML转Word文件",
    "HTML to Word conversion",
    "将HTML内容和样式转换为可编辑Word文档。"
  ],
  "legal-contract-expert": [
    "合同起草与条款审查",
    "Contract drafting and review",
    "起草和审查合同条款，核对权利义务与潜在风险。"
  ],
  "library": [
    "资料库与文件整理",
    "Knowledge library management",
    "查找、归档和整理资料库文件，按权限处理分享与发布。"
  ],
  "livestream-poster": [
    "直播宣传海报",
    "Livestream promotional posters",
    "结合人物、品牌和活动信息，制作直播预告与宣传海报。"
  ],
  "marketplace-skill-installer": [
    "技能搜索与安装",
    "Skill search and installation",
    "在技能市场查找并安装所需技能，检查来源和依赖。"
  ],
  "miora-brand-design": [
    "品牌Logo与视觉体系",
    "Brand identity design",
    "设计品牌Logo、吉祥物与视觉规范，保持系列一致性。"
  ],
  "miora-creative-core": [
    "创意媒体工作流",
    "Creative media workflows",
    "为图片和视频生成组织素材、参数、工具与交付检查。"
  ],
  "miora-image-generation": [
    "图片生成与编辑",
    "Image generation and editing",
    "生成与编辑图片，处理参考图、构图、比例和系列一致性。"
  ],
  "miora-video-generation": [
    "视频生成与镜头规划",
    "Video generation",
    "规划镜头与运动，按素材和画幅生成视频。"
  ],
  "poetry-prose-expert": [
    "诗歌散文创作",
    "Poetry and prose",
    "创作和润色诗歌、散文、随笔及文学评论。"
  ],
  "product-design-review": [
    "产品需求与体验评审",
    "Product and UX review",
    "检查需求、交互与用户体验，明确问题优先级和改进建议。"
  ],
  "recommend-connectors": [
    "查找应用与数据连接",
    "Find app and data connectors",
    "任务缺少外部服务或数据工具时，识别所需连接器与授权。"
  ],
  "recommend-experts": [
    "专业角色推荐",
    "Find the right expert",
    "根据任务领域和专业判断需求，推荐合适专家或专家团。"
  ],
  "risk-compliance-review": [
    "风险与合规初审",
    "Risk and compliance review",
    "整理安全、隐私和业务合规问题，标明证据与专业复核事项。"
  ],
  "science-writing-expert": [
    "科普文章与科学解读",
    "Science communication",
    "把科学与技术资料写成面向大众的解释、评测和文章。"
  ],
  "shared-styles": [
    "设计共享样式",
    "Shared design styles",
    "管理画布文本、填充、描边和效果的共享样式。"
  ],
  "sites": [
    "网站部署与发布",
    "Website deployment",
    "将已有网站或应用发布为在线链接，需要对应托管服务。"
  ],
  "skill-creator": [
    "自定义技能编写",
    "Custom Skill authoring",
    "把重复任务整理为可复用技能，编写流程与配套资源。"
  ],
  "software-delivery": [
    "软件开发与交付",
    "Software development",
    "实现、调试和评审代码，完成测试与交付说明。"
  ],
  "stock-research-report-expert": [
    "证券与行业研究报告",
    "Equity and industry reports",
    "围绕公司或行业整理证据、分析框架并撰写研究报告。"
  ],
  "tdoc-orchestrator": [
    "文档创作与排版编排",
    "Document production workflow",
    "组织写作、排版及Word转换，按文档需求选择处理流程。"
  ],
  "tech-blog-expert": [
    "技术文章与教程",
    "Technical articles and tutorials",
    "撰写技术博客、教程和项目说明，核对代码及技术依据。"
  ],
  "tencent-docs-routing": [
    "Office文件操作入口",
    "Office file routing",
    "识别本地Word、Excel、PPT及云文档，选择适合的操作通道。"
  ],
  "tencent-docs-sheet-generation": [
    "新建Excel工作簿",
    "Create Excel workbooks",
    "根据文字或资料制作新的Excel工作簿、表头和数据结构。"
  ],
  "tencent-docs-sheetagent": [
    "Excel编辑与数据整理",
    "Edit and organize Excel",
    "修改已有Excel，清洗、透视、排序并构造公式和图表。"
  ],
  "tencent-docs": [
    "腾讯文档个人版",
    "Tencent Docs Personal",
    "读写个人版腾讯云文档，管理内容、表格与相关文件。"
  ],
  "tencent-docx": [
    "Word创作与专业排版",
    "Word production and typesetting",
    "制作专业Word文档，完成内容、版式与文件导出。"
  ],
  "tencent-local-office-edit": [
    "本地Office文件编辑",
    "Local Office editing",
    "通过可用本地编辑器打开、编辑和保存Word、Excel、PPT。"
  ],
  "tencent-pptx": [
    "PPT制作与改稿",
    "PowerPoint production",
    "从材料生成PPT，理解已有幻灯片并按页修改内容。"
  ],
  "tencent-saas-docs": [
    "腾讯文档企业版",
    "Tencent Docs Enterprise",
    "读写企业版腾讯文档和资料库文档，遵循已有访问权限。"
  ],
  "wecom-forwarded-chat-resources": [
    "企业微信聊天资料提取",
    "WeCom archive resources",
    "读取转发聊天记录中的在线资料，整理消息关联资源。"
  ],
  "weixinpay-feedback": [
    "微信支付问题反馈",
    "WeChat Pay issue reporting",
    "收集微信AI支付开通、绑定与支付异常，按流程反馈。"
  ],
  "weixinpay-pay": [
    "微信AI支付与重新付款",
    "WeChat AI payments",
    "处理已授权订单的支付与重新付款流程。"
  ],
  "weixinpay-register": [
    "微信AI支付开通与查询",
    "WeChat AI payment setup",
    "协助开通、绑定并查询微信AI支付或专属卡状态。"
  ],
  "work-report-expert": [
    "工作总结与述职报告",
    "Work reports and reviews",
    "撰写周报、月报、项目汇报、年度总结与述职材料。"
  ],
  "office-word-workflow": [
    "Word文档与模板",
    "Word documents and templates",
    "制作通知、方案和制度文档，处理模板、目录、编号与修订。"
  ],
  "office-ppt-workflow": [
    "PPT工作汇报与讲稿",
    "Presentations and speaker notes",
    "将业务材料整理成可编辑PPT，配套讲稿并检查逐页版式。"
  ],
  "office-excel-workflow": [
    "Excel台账与办公表格",
    "Excel trackers and office tables",
    "制作台账、预算和进度表，配置公式、下拉、汇总与图表。"
  ],
  "office-pdf-workflow": [
    "PDF阅读与文件整理",
    "PDF reading and organization",
    "摘录PDF、合并拆分及转换资料，检查OCR和脱敏结果。"
  ],
  "office-meeting-minutes": [
    "会议纪要与行动清单",
    "Meeting minutes and action items",
    "从笔记或转写提炼决策、分歧、负责人及截止时间。"
  ],
  "office-email-drafting": [
    "办公邮件与客户回复",
    "Office emails and replies",
    "起草通知、客户回复和催办邮件，明确诉求及下一步。"
  ],
  "office-document-comparison": [
    "文档版本对比",
    "Document version comparison",
    "比较两版文档，定位增删、数字及责任条款变化。"
  ],
  "office-document-translation": [
    "文档翻译与双语对照",
    "Document translation",
    "翻译Word、PPT、表格及往来材料，保持术语和数字一致。"
  ]
}

export function skillDisplayName(name: string, locale: 'zh' | 'en'): string {
  const item = Object.hasOwn(BUNDLED_SKILL_PRESENTATION, name) ? BUNDLED_SKILL_PRESENTATION[name] : undefined
  return item?.[locale === 'zh' ? 0 : 1] ?? name
}

export function skillSearchText(name: string): string {
  return `${name} ${Object.hasOwn(BUNDLED_SKILL_PRESENTATION, name) ? BUNDLED_SKILL_PRESENTATION[name]!.join(' ') : ''}`
}

export function presentSkill(skill: Pick<DesktopSkillView, 'name' | 'description' | 'source'>, locale: 'zh' | 'en'): { name: string; description: string } {
  const item = (skill.source === 'bundled' || skill.source === 'global') && Object.hasOwn(BUNDLED_SKILL_PRESENTATION, skill.name) ? BUNDLED_SKILL_PRESENTATION[skill.name] : undefined
  return { name: item?.[locale === 'zh' ? 0 : 1] ?? skill.name, description: locale === 'zh' ? item?.[2] ?? skill.description : skill.description }
}
