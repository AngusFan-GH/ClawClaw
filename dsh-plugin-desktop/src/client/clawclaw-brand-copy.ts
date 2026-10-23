/** Desktop presentation adapter for upstream product copy; never rewrite transcripts. */
const CONTENT_SELECTOR = '[data-chat-flow-kind], [data-slot="conversation.chat.user.content"], pre, code, textarea, input, [contenteditable="true"]'
const HERO_SELECTOR = '[data-slot^="conversation.hero."], :has(> span > [data-slot="conversation.hero.brand.mark"])'
const CHROME_SELECTOR = `[data-slot^="sidebar.brand."], ${HERO_SELECTOR}, [data-slot^="settings."], [data-slot="shell.overlay"], [data-slot="shell.quota-notice"], [data-window-drag], [data-desktop-onboarding]`

const PRODUCT_COPY = new Map([
  ["DeepSeek Harness 0.2 is still in preview, and many areas need continued improvement and refinement. We welcome feedback and suggestions from all developers and users. The new desktop app now targets a broad range of users, while developer-related advanced features can be enabled in the settings. DeepSeek Harness’s product features and plugin APIs are expected to continue rapid iteration and evolution, and will gradually stabilize over time.", "ClawClaw brings conversations, tools, and skills into one workspace to help you turn ideas into action. Choose a model and connect the tools you need to get started."],
  ["We look forward to exploring the limits of intelligence together with users and developers around the world, building on open-source, reusable, and composable infrastructure. We welcome everyone to bring their ideas to life with DeepSeek Harness and participate in the community to enrich the plugin ecosystem.", "Adjust how you work in Settings and extend your capabilities with plugins."],
  ["DeepSeek Harness 目前的 0.2 版本仍处于预览阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者和用户的反馈建议。现在，新的桌面端面向广泛用户，开发者相关的进阶功能可在配置中开启使用。预计 DeepSeek Harness 的产品功能以及插件 API 都会继续快速迭代、持续演化，并逐渐趋于稳定。", "ClawClaw 将对话、工具和技能整合在同一个工作空间中，帮助你从想法走向行动。选择适合的模型，连接所需工具，即可开始。"],
  ["我们期待与全球用户和开发者一起，在开源、可复用、可组合的基础设施之上，共同探索智能上限。欢迎大家用 DeepSeek Harness 将想法变成现实，与社区一起丰富插件生态。", "你可以在设置中调整工作方式，并通过插件扩展能力。"],
  ['请确认插件来源可信。插件在本机以你的权限运行，来源不明的插件可能损坏 DeepSeek Harness，或读取和泄露你的数据。', '请确认插件来源可信。插件在本机以你的权限运行，来源不明的插件可能损坏 ClawClaw，或读取和泄露你的数据。'],
  ['Install only plugins you trust: they run with your permissions and can damage DeepSeek Harness or leak your data.', 'Install only plugins you trust: they run with your permissions and can damage ClawClaw or leak your data.'],
  ['DeepSeek Harness', 'ClawClaw'],
  ['DSH', 'ClawClaw'],
  ['DSH 本地构建', 'ClawClaw 本地构建'],
  ['DSH Local Build', 'ClawClaw Local Build'],
  ['探索未至之境', 'ClawClaw，万物皆有回响'],
  ['Into the Unknown', 'ClawClaw, every thought finds an answer'],
  ['返回 DeepSeek Harness', '返回 ClawClaw'],
  ['没有可用额度时，DeepSeek Harness 无法开始新的任务，是否前往充值？或者可以稍后前往 设置 → 账号与余额 进行充值。', 'DeepSeek 账号没有可用额度，无法开始新的任务。是否前往充值？也可以稍后前往 设置 → 账号与余额 进行充值。'],
  ['DeepSeek Harness cannot start a new task with this account when no balance is available. Would you like to top up? You can also top up later in Settings → Account.', 'This DeepSeek account has no available balance, so a new task cannot start. Would you like to top up? You can also top up later in Settings → Account.'],
  ['Back to DeepSeek Harness', 'Back to ClawClaw'],
  ['当前未登录 DeepSeek Harness 账号', '当前未登录 DeepSeek 账号'],
  ['登录 DeepSeek Harness 账号获取专属 API Key', '登录 DeepSeek 账号获取专属 API Key'],
  ['You are not signed in to DeepSeek Harness', 'You are not signed in to DeepSeek'],
  ['Sign in to DeepSeek Harness to get your dedicated API Key', 'Sign in to DeepSeek to get your dedicated API Key'],
])

/** Match only a full running label, preserving the upstream localized duration. */
function runningCopy(text: string): string {
  if (/^深度求索中(?:\.{3}|…)?$/u.test(text)) return '正在处理'
  if (/^Deep diving(?:\.{3}|…)?$/u.test(text)) return 'Working'
  const zh = /^深度求索中，用时 (.+) ···$/u.exec(text)
  if (zh) return `正在处理，用时 ${zh[1]} ···`
  const en = /^Deep diving for (.+) ···$/u.exec(text)
  if (en) return `Working for ${en[1]} ···`
  return text
}

function replaceText(node: Node): void {
  const parent = node.parentElement
  if (!parent || parent.closest(CONTENT_SELECTOR)) return
  const text = node.textContent ?? ''
  if (parent.closest('[data-chat-running]')) {
    const replacement = runningCopy(text)
    // Updating Text.data preserves React's node identity on subsequent clock ticks.
    if (replacement !== text) node.nodeValue = replacement
    return
  }
  if (!parent.closest(CHROME_SELECTOR)) return
  const replacement = PRODUCT_COPY.get(text)
  if (replacement !== undefined) node.nodeValue = replacement
  if ((text === '预览版' || text === 'Preview') && parent.closest(HERO_SELECTOR)) {
    parent.style.setProperty('display', 'none', 'important')
  }
}

/** TextShimmer paints an inert ::after copy from an attribute, outside the text tree. */
function replaceRunningShimmer(element: Element): void {
  if (!element.closest('[data-chat-running]') || element.closest(CONTENT_SELECTOR)) return
  const text = element.getAttribute('data-shimmer-text')
  if (text === null) return
  const replacement = runningCopy(text)
  if (replacement !== text) element.setAttribute('data-shimmer-text', replacement)
}

/** Handle both added subtrees and React's in-place Text.data updates. */
export function replaceClawClawProductCopy(root: Node = document): void {
  if (root.nodeType === Node.TEXT_NODE) {
    replaceText(root)
    return
  }
  if (root instanceof Element) replaceRunningShimmer(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node instanceof Element) {
        if (node.matches(CONTENT_SELECTOR)) return NodeFilter.FILTER_REJECT
        replaceRunningShimmer(node)
      }
      return node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    },
  })
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) replaceText(node)
}
