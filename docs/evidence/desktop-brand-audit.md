# ClawClaw desktop brand audit

Date: 2026-10-23

## Findings and changes

| Surface | Finding | Desktop adaptation |
| --- | --- | --- |
| Running conversation | Upstream changed the old ellipsis-only label into `chat.deepDiving` and `chat.deepDivingFor`, including elapsed time. | Use `正在处理` / `Working`, retaining localized elapsed time and the stable screen-reader status. |
| Running animation | `TextShimmer` paints a second copy through `data-shimmer-text` and a CSS pseudo-element. Replacing only text nodes leaves the original glyphs over the new label. | Adapt the decorative attribute as well as text; observe attribute updates when the clock or language changes. |
| Running icon | Upstream uses an animated whale tail. | Show the existing ClawClaw product icon in the same decorative footprint. |
| New conversation | `conversation.content` is a factory and does not supply the assumed DOM wrapper. | Identify the actual headline through its `conversation.hero.brand.mark` slot anchor, independently of the factory wrapper. Restore the existing bilingual ClawClaw headline and hide only the hero preview badge. |
| Welcome notice | Two paragraphs promote DeepSeek Harness 0.2 and its ecosystem. | Provide a bilingual ClawClaw introduction. Match individual paragraphs because the upstream notice splits its locale template before rendering. |
| Account pages | Return navigation and signed-out copy call the application DeepSeek Harness. | Return to ClawClaw; identify the actual account as a DeepSeek account. Balance prompts continue to describe the DeepSeek account's balance. |
| Plugin installation | Safety copy identifies the application as DeepSeek Harness. | Identify the application as ClawClaw and preserve the explanation of plugin privileges. |
| Sidebar / local build | Existing product identity adaptation needs to continue working. | Preserve ClawClaw mark/name and favicon, adapt local-build labels in product chrome, and rebrand the page-title suffix when the upstream shell switches sessions. |

## Scope and intentionally retained names

The scan covered desktop client sources and upstream client locale dictionaries. DeepSeek model/provider/account names, search-provider descriptions, session-log contribution descriptions, DSH plugin compatibility versions, runtime diagnostics, package identifiers and environment-variable names remain accurate technical or service names. The Office-preview host-service error also still identifies the upstream Harness service; it is a technical service diagnostic, not promotional copy.

The adapter is limited to known product chrome and the running-status surface. Message seats, tool output, code, editable inputs and user session titles are excluded. The pinned upstream checkout and compatibility profile composition are unchanged.

## Validation

- Regression tests cover initial and delayed mounting, Chinese and English labels, elapsed-time ticks, attribute-based shimmer copies, locale changes, screen-reader semantics, disposal, transcript preservation, the factory-free hero structure and paragraph-based welcome rendering.
- A temporary browser fixture rendered the actual pinned upstream `HeroShell` and `RunningStatus` components with the desktop adapter. The running component used the actual upstream `TextShimmer`, CSS and live clock. The fixture supplied presentation-only slot anchors and locale functions; it did not launch a second desktop application or send model requests.
- Browser inspection confirmed the visible text, decorative attribute and generated pseudo-element contain the same localized label. The live region remains clipped to 1×1px. Chinese light-theme and English dark-theme screenshots were inspected; the preview badge is hidden and the headline remains branded after switching languages.
- `corepack pnpm check` passed with 189 desktop test files, 1,552 passing tests and 6 skipped tests. The last title/preview-scope refinements additionally passed the final build, type checking and all 10 focused brand regression tests.
