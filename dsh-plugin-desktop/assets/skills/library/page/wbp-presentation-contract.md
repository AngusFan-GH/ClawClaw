# WBP Presentation HTML Generation Contract (referenced within skills)

> This document is the **minimal contract** for `md_to_html.py --format presentation` and for an agent directly authoring presentation HTML.

---

## 0. Scope

When `md-to-html-flow.md` §3 determines the target is the **presentation** format, `md_to_html.py --format presentation` generates a WBP-native html conforming to this contract. The output can be paged through by the player (page navigation / dual-screen / laser pointer / stepwise reveal); the subsequent `import_html.py` import/mounting behaves exactly like a long page.

**Responsibility boundary (read this first)**: this contract only covers the **outer frame adapting to presentation mode** — root markers, page structure, the 16:9 fixed box, the speaker-notes slot, `.is-active` timing. **What each page looks like inside is not this contract's job**: every page is a **magazine-grade web page** laid out per `beautify/beautify-guide.md`, not a slide layout. In short: **the frame is for presenting; the content is a web page.**

---

## 1. Mandatory skeleton structure

> Below is the **final form after slide-building**. `md_to_html.py --format presentation` only emits an empty frame (no visible DOM inside any slide, only raw material and speaker notes); the in-page DOM is written by the agent slide by slide — see §12.

```html
<!doctype html>
<html lang="zh" data-wbp data-wbp-version="1.1"
      data-aspect="16:9" data-design-w="1280" data-design-h="720">
<head>
  <meta charset="utf-8" />
  <title>{{report topic}}</title>
  <script type="application/json" id="wbp-meta">{ ... }</script>
  <style>/* :root theme variables + .is-active in-slide animations + reduced-motion degradation */</style>
</head>
<body>
  <main data-wbp-deck>
    <section data-wbp-slide data-slide-id="s1" data-layout="cover"
             data-zone="overview" data-transition="slide-left">
      <!-- in-page DOM decided by the agent per that page's content; structure unconstrained -->
      <aside data-wbp-notes>speaker script (150-300 chars, conversational, key terms bolded)</aside>
    </section>
    <!-- more slides -->
  </main>
</body>
</html>
```

---

## 2. Attribute quick reference

- `<html>` `data-wbp` — required — present with no value needed
- `<html>` `data-wbp-version` — required — `"1.1"`
- `<html>` `data-aspect` — required — `16:9` (default) / `4:3` / `3:4` (portrait) / `1:1` (square)
- `<html>` `data-design-w` / `data-design-h` — recommended — `1280` / `720` (for 16:9)
- `<main>` `data-wbp-deck` — recommended — deck container
- `<section>` `data-wbp-slide` — required — one slide per section
- `<section>` `data-slide-id` — recommended — a stable unique id (`s1`, `s2`, …)
- `<section>` `data-layout` — optional — content-type hint (`cover` / `kpi` / `bullets` / `chart` / `cta`); **a hint only, not a layout template** — never apply a PPT master from it
- `<section>` `data-zone` — recommended — `overview` / `data` / `logic` / `next` (the four-zone structure)
- `<section>` `data-transition` — optional — `none` / `slide-left` / `slide-up` / `zoom`
- child element `data-wbp-fragment` — optional — stepwise reveal within a slide
- child element `data-wbp-no-advance` — optional — clicking this element does not advance the slide (interactive areas / links / charts)
- `<aside>` `data-wbp-notes` — recommended — speaker script (hidden from the audience, shown to the presenter); also compatible with `.slide-notes` / `[data-notes]`
- `<script>` `data-wbp-source` — baseline artifact — that page's md raw material for the agent to read when building; **must be deleted after building** (see §12)

---

## 3. The four-zone structure (data-zone)

Presentation pages are divided into four zones by narrative logic; each slide's `data-zone` marks which zone it belongs to:

- `overview` — overview / conclusion — cover slide TL;DR, headline number
- `data` — key data — KPI cards, charts, growth curves
- `logic` — supporting logic — cause analysis, comparison tables, technical approach
- `next` — next steps / risks — action items, risk list, CTA

---

## 4. Slide-count and content constraints

- **Never overflow the box (core rule)**: every slide renders as a 16:9 fixed box (1280×720); content **must never overflow** it. `md_to_html.py --format presentation` **auto-paginates** by box height — a long section is split into multiple continuation slides, raw material distributed item by item. So **slide count is driven by "does it fit", and can exceed 8**; ≤8 is only a conciseness recommendation, no longer a hard merge requirement.
  > Pagination is an **estimate based on raw material**. If a page still overflows after building, lower the density / shrink the font, or split that page's material into one more page (copy the shell attributes, give the new page a fresh `data-slide-id`).
- **Minimum content**: if the source md < 200 characters → prompt the user to add more, never generate an empty shell (`md_to_html.py --format presentation` **hard-validates** this: under 200 characters it returns `{"error":...}` asking for more content)
- **The first slide must be a cover** (`data-layout="cover"` + `data-zone="overview"`), leading with the core conclusion / TL;DR
- **The last slide should be a cta** (`data-layout="cta"` + `data-zone="next"`), giving next steps or risks

---

## 5. Speaker-script rules

Each slide's `<aside data-wbp-notes>` holds a conversational speaker script, **targeting 150-300 characters**:

- Distill the core argument + transition from that section's source md
- **Bold** key numbers/terms as delivery cues
- Do not simply restate the slide body — add spoken-style "how to say it" color

> **Length expectation**: `md_to_html.py` only produces a **draft script** (distilled from that section's body; length varies with the md content and may fall short of 150 characters). The 150-300 character target is an **agent enrichment goal** — enrich a too-short script up to that range; the script itself does not pad to hit a word count.

**Script enrichment**: the script lives in `<aside data-wbp-notes>`; the agent enriches the draft up to 150-300 characters per slide.

### 5.1 Visibility contract (single container + always hidden)

The speaker script is **for the presenter only and never appears in the slide picture**. Visibility is the player's decision; the html side only has to "store it and hide it":

- **Browsing state** (iframe renders the html directly; slides stack vertically): the script is **invisible**, guaranteed by the baseline CSS `[data-wbp-notes] { display: none; }`
- **Presentation state** (player mounted): the player **reads the text from `data-wbp-notes` and renders it into its own presenter panel** (visible on the presenter's side); the audience's projected picture does not contain it

Three hard constraints (most easily violated during enrichment):

1. **Single container**: the script / speaker hints / spoken draft may live **only** inside `<aside data-wbp-notes>`.
2. **No self-built visible hint blocks**: never write narration into body `<p>` / `<blockquote>`, and never build any **visible** card, footnote, or sidebar labeled "speaker notes / narration / 备注" to carry it.
3. **The always-hidden CSS must not be lost**: when rewriting `<style>` for reskinning, keep `[data-wbp-notes] { display: none; }`, and never override it with `display:block` / `visibility` etc.

---

## 6. In-slide animation (.is-active CSS)

> **Rendering context (critical — determines how the animation must be written)**: this html has **two rendering states** in the library page —
> - **Browsing state (default)**: the iframe **renders the html directly**, all `<section data-wbp-slide>` elements **stack vertically into a static long page**; **there is no paging and `.is-active` is never added** (`.is-active` is only added by the `MindxPresentation` player during presentation state).
> - **Presentation state**: clicking the "Present" button mounts the player, which pages through slides one at a time, adds `.is-active` to the current slide, and runs the transition.
>
> Therefore **never pre-hide elements with `opacity:0`** — in browsing state there is no `.is-active`, and pre-hiding would cause **the whole slide to render blank** (it would also break the SDK-less fallback for database snapshots). The correct approach: **elements are visible by default**; `.is-active` is only used to **replay the entrance animation** (played again each time the slide is navigated to); elements display normally when not the active slide.

**Easing curves**: standard entrances use `cubic-bezier(.4,0,.2,1)`; emphasis/pop-in uses the bouncier `cubic-bezier(.22,1,3,.36,1)`.

**Performance rule (decides presentation smoothness — mandatory)**: entrance animations only animate `transform` / `opacity` (GPU-compositable). `filter: blur()` / `backdrop-filter` force re-rasterization every frame — the most expensive operations. **Batch elements (paragraphs, list items, cards, tables) must never carry blur in their entrance**; a dozen elements blurring at once will guaranteed drop frames. Blur effects are allowed only on **that page's single hero element**, and **never stacked with an infinite loop animation**.

```css
:root {
  --ease: cubic-bezier(.4,0,.2,1);
  --ease-bounce: cubic-bezier(.22,1.3,.36,1);
}
/* Entrance keyframes: rise (transform+opacity only, compositor-accelerated) / blur-focus (single hero only) / zoom pop */
@keyframes wbpRise   { from { opacity:0; transform:translateY(40px) scale(.985); }
                       to   { opacity:1; transform:none; } }
@keyframes wbpBlurIn { from { opacity:0; filter:blur(16px); } to { opacity:1; filter:none; } }
@keyframes wbpZoom   { 0% { opacity:0; transform:scale(.86); } 60% { transform:scale(1.03); }
                       100% { opacity:1; transform:scale(1); } }

/* Do not write pre-hiding like [data-wbp-slide] .xxx { opacity:0 } — blank screen in browsing state */
/* Elements visible by default; only .is-active replays the entrance (the from-state carries opacity:0, ending visible) */
/* Class names below are placeholders — substitute the real ones you use when building. */
/* That page's hero: blur-focus allowed (single element) */
[data-wbp-slide].is-active .your-hero  { animation: wbpBlurIn .8s var(--ease) both; }
/* Secondary elements: transform+opacity rise */
[data-wbp-slide].is-active .your-sub   { animation: wbpRise .55s var(--ease) .12s both; }
/* Batch sibling elements: stagger (each level +0.08s) */
[data-wbp-slide].is-active .your-item  { animation: wbpRise .5s var(--ease) both; }
[data-wbp-slide].is-active .your-item:nth-child(1) { animation-delay:.12s; }
[data-wbp-slide].is-active .your-item:nth-child(2) { animation-delay:.20s; }
[data-wbp-slide].is-active .your-item:nth-child(3) { animation-delay:.28s; }
[data-wbp-slide].is-active .your-item:nth-child(n+4) { animation-delay:.36s; }
/* Emphasis blocks (quotes / figures): zoom pop */
[data-wbp-slide].is-active .your-quote { animation: wbpZoom .55s var(--ease-bounce) .1s both; }

@media (prefers-reduced-motion: reduce) {
  [data-wbp-slide] * { animation: none !important; }
}
```

> Keep ≤2 entrance types active on a single slide (e.g. "hero focus + batch stagger") — more becomes chaotic.
> Continuous decorative animation (shimmer sweeps, gradient flows) is costly and **cannot be compositor-accelerated** (`background-position` repaints every frame). If used, all three must hold: ① at most 1 per page; ② it stops after playing (never `infinite`); ③ never stacked on an element that already has blur.

---

## 7. Skin interface (the `:root` variable list)

> **Where beautify's responsibility lies**: this contract **carries no visual design spec** (typography / spacing / color / material / shadow / background / layout) — that is `beautify/beautify-guide.md`'s job. This section only fixes one thing: which variable names the `md_to_html.py --format presentation` artifact exposes in `:root` for the building stage to overwrite.
>
> **The baseline values are placeholder gray, not a design choice**: the script fills these variables uniformly with **achromatic gray** (zero hue, zero saturation), deliberately plain. **They must be overwritten per the beautify style routing** — shipping with placeholder gray = not beautified.

**Variables that must be overwritten**:

- `--accent` / `--accent2` / `--accent3` — brand three-color set (emphasis, gradients, markers, CTA); baseline is the same gray for all
- `--accent-rgb` / `--accent2-rgb` / `--accent3-rgb` — the `R,G,B` forms of the above, for `rgba()` translucent layering
- `--bg` / `--panel` — page background / slide panel color
- `--text` / `--muted` — body text color / secondary text color

**Do not change (timing contract, not color)**: `--ease` / `--ease-bounce` (entrance easing, see §6).

> The concrete color choices, gradient composition, material translucency, surface colors etc. are **all decided by beautify** (the baseline does not preset composite visual variables like `--grad`/`--surface`; define your own if needed). Overwriting must respect the shell and timing constraints of §7.10.3.
>
> The next section §7.10 is the **building master plan** (parallel to skinning, not subordinate to it): how to lay each page's material out slide by slide, how the 16:9 fit works, and what the red lines are.

## 7.10 Per-slide building (operating guide + safety red lines)

> **What this section is**: the `--format presentation` artifact is an **empty frame** — each slide has only the shell, invisible raw material, and the speaker-notes slot; **no visible DOM inside** (see §12). The agent's job is to lay the material out, slide by slide.
> **The layout language is not in this contract**: every page's typographic design **follows `beautify/beautify-guide.md` without exception** (section semantics, 5-level typography, spacing rhythm, visual techniques, anti-AI-look red lines). This section answers only two things: where one slide's boundary is (§7.10.1), and what to watch when fitting into 16:9 (§7.10.2 / §7.10.3).

### 7.10.1 What "per slide" means: a slide's frame and your part

**One slide = one `<section data-wbp-slide>`** (rendered as a 1280×720 fixed box). Each baseline slide contains only three parts:

```
<section data-wbp-slide data-layout="…" data-zone="…" data-transition="…">   ← shell: attributes and outer size untouchable
  <script type="text/markdown" data-wbp-source>…that page's md material…</script>  ← material: read it, delete when done
  <aside data-wbp-notes>…speaker script…</aside>                              ← notes slot: hidden, untouchable
</section>
```

**Per-slide building = read the material → write the page DOM inside the shell → delete that page's `<script data-wbp-source>`**. The material is a markdown fragment; it carries the `data-wbp-source` marker and the baseline CSS keeps it unrendered. **It must be deleted page by page after building** — residue means that page was never built (see the §12 hard gate).

### 7.10.2 Lay out every page as a magazine web page, not a PPT layout

**Mental model**: treat each slide as **one standalone magazine-grade web page** (whose first screen happens to be 1280×720), **not** a presentation slide. All layout decisions go through `beautify/beautify-guide.md`: pick its **section semantics** by content structure (`DocHero` / `RichParagraph` / `DataHighlight` / `QuoteBlock` / `TimelineList` / `ComparisonGrid` / `ImageFrame` …), apply its 5-level typography, 8px spacing rhythm, visual techniques, and section enhancement guide; its "anti-pattern red lines" and "content principles (re-layout first)" apply in full — including **compressing, distilling, and rearranging the material**; do not be a photocopier.

**Three adaptations the 16:9 fixed box adds** (the only additions this contract makes; everything else obeys beautify):

- beautify's "first screen fully visible within 100vh" → here "first screen" = that slide's 1280×720 box; every page is a first screen
- beautify's 64-96px section spacing, multi-section vertical flow → one page carries **one** content unit; vertical rhythm compresses into the box; cross-page continuous backgrounds / scroll narratives are unavailable (red zone 5 in §7.10.3)
- beautify's 14-16px body, 3-5 info units per screen → projection viewing distance is far, so body may rise to 18-22px; aim for 2-4 info units per page, lower density than a long page

**Two per-page self-checks**:

1. **Not a PPT**: pulled out of its shell and viewed alone, the page should read like a carefully typeset web first screen, not "title + bullet list".
2. **Pages differ**: adjacent pages must not repeat section semantics and layout structure.

### 7.10.3 Safety red lines

> **Only two categories of constraint**: the **shell** (size + data attributes — the player relies on them to page and scale) and **timing** (`.is-active` / no pre-hiding / no JS — these keep browsing state from blanking and presentation state from stuttering). **Everything inside a slide** — `display`, layout mechanism, padding, stacking, grids — **is unconstrained and fully rewritable.**
>
> **One-line rule: lock the shell and the timing; typeset the page interior freely.**

**✅ Green zone (free)**

- Colors / theme: overwrite `:root`'s `--accent`/`--accent2`/`--accent3`/`--bg`/`--panel`/`--text`/`--muted` (§7 skin interface — the only sanctioned way to reskin)
- Fonts: pull in a whitelist-domain webfont (fontsource via `cdn.jsdelivr.net`, Chinese fonts limited to a single weight), change `font-family` / weight / letter-spacing / `clamp()` sizes
- **In-page layout mechanism**: freely rewrite the slide interior's `display` (`grid`/`flex`/`block`), `grid-template`, `flex-direction`, alignment, stacking (`position:absolute` + `z-index`) — as long as the page still renders within 1280×720
- **In-page padding / bleed**: freely change the slide's `padding` (including to `0` for **full-bleed**: edge-to-edge backdrops, full-width side color blocks, images bleeding to the edge)
- In-box grids: bento grids, card grids, columns, asymmetric layouts — all allowed inside the single-page box (as long as nothing overflows; see the yellow-zone height constraint)
- Card materials: glowing borders, layered shadows, inner highlights, translucent fills
- Local gradients / accents: brand gradients on ordinals/bullets, gradient bars beside titles, quote left-borders (static gradients; no infinite shimmer)
- Entrance animation: add/adjust keyframes **within the existing `.is-active` hooks** (see §6), keeping "visible by default, `.is-active` only replays"; **animate `transform`/`opacity` only**
- Data / charts: table borders, monospace numerals, mermaid theme variables (following `:root`)

**⚠️ Yellow zone (allowed under conditions, must visually confirm no overflow)**

- High-density in-page layouts: any layout must **visually fit within ≤720px rendered height**; if over, lower density, shrink fonts, or split the page
- In-box glows: the glow must stay **inside the slide box** (`overflow:hidden` + in-box radial gradient), never spilling into the page background outside the slide
- Frosted glass `backdrop-filter`: **at most 2 per page**, and that element **must not also carry an entrance animation** (blur + animation on the same frame = per-frame resampling = dropped frames). Prefer translucent fills + border highlights + shadows for card texture

**⛔ Red zone (absolutely forbidden — breaks the player contract)**

1. Do not delete/alter the `<html data-wbp ...>` root marker or `data-aspect`/`data-design-w`/`data-design-h` (see §1).
2. **Do not change a slide's outer rendered size**: every `[data-wbp-slide]` must finally be a **standalone 1280×720 box** with no overflowing content. (Only the *outer* size is locked; the slide **interior's** `display`/`padding`/layout mechanism is exempt — see the green zone.)
3. No pre-hidden elements: static `opacity:0` / `clip-path:inset(0 100%…)` "hide it and reveal only via animation" is banned — browsing state has no `.is-active` and would **blank the whole page** (see §6).
4. Do not delete/touch `data-layout`/`data-zone`/`data-transition`/`<aside data-wbp-notes>`/`#wbp-meta`; do not drop `[data-wbp-notes] { display: none; }`, move the script out of `<aside>`, or build visible "speaker notes" blocks (see §5.1).
5. **No cross-page / scroll-dependent layouts**: multi-screen zig-zag alternation, `100vh` full-screen heroes, backgrounds continuing across slides, scroll-position-dependent effects (parallax, `position:sticky`, scroll-driven animation) — every page must stand alone. (Bento / grids / bleed inside a single page box are **not** this item and are allowed.)
6. No frame-dropping animation: batch elements (paragraphs / list items / cards / tables and other sibling groups) must **not carry `filter: blur()`** in their entrance; no `infinite` loop animations on any element; no entrance animation added on an element that already has `backdrop-filter` (see the §6 performance rule).

**Post-build self-check**

> Beautification quality itself follows the `beautify/beautify-guide.md` self-check list item by item; below are only the checks **specific to the paged format**.

- [ ] **Every page built**: all `data-wbp-slide` elements contain visible DOM **and no `data-wbp-source` residue** (grep `data-wbp-source` should hit 0).
- [ ] **Not a PPT**: any page viewed alone is "one magazine-grade typeset web page", not "title + bullet list".
- [ ] **Pages differ**: adjacent pages' section semantics and layout structures are not alike.
- [ ] **Colors overwritten**: `:root`'s `--accent`/`--bg`/`--panel` etc. now hold real colors per the beautify style routing, **no placeholder gray residue** (the baseline grays `#8f8f8f` / `#121212` / `#1c1c1c` must not appear in the artifact).
- [ ] No statically pre-hidden elements (no `opacity:0` / `clip-path` hiding); every page visible in browsing state.
- [ ] Every page still renders as a standalone 1280×720 box with no overflow; no cross-page / scroll-dependent layout.
- [ ] **Animation doesn't stutter**: batch-element entrances use only `transform`/`opacity` (grep the entrance keyframes for `blur` — expect none); no `infinite` animations; `backdrop-filter` ≤2 per page and never on an element with an entrance animation.
- [ ] **Script not leaked**: every page's script still inside `<aside data-wbp-notes>`; `[data-wbp-notes] { display: none; }` still present; no visible "speaker notes / narration" text anywhere (see §5.1).
- [ ] `data-wbp` root marker, `data-layout`/`data-zone`, `<aside data-wbp-notes>` all intact.
- [ ] **Content faithful to the material**: page text comes from the material (compression/rearrangement allowed per the beautify content principles); no conclusions/data absent from the material were added (see §8).

---

## 8. Anti-fabrication / source traceability

- No-source data → label it "待补充" (to be filled in) + the `data-wbp-todo` attribute, **never make it up**:
```html
<div class="kpi-num" data-wbp-todo>待补充</div>
```
- Key numbers/conclusions register their source in the meta JSON island's `slides[].sources`

---

## 9. database binding markers

Applies only when the presentation file is a **dynamic data page** (goes through `data-page-flow.md`, data sourced from a database): per `canonical-schema.md` §1.5.5, add database binding markers to elements whose text comes directly or indirectly (derived) from a database. Typical elements hit in presentation files: slide titles, body paragraphs / bullets, KPI numbers (indirectly derived), `<img>` images.

> A purely static presentation file (the md→html branch, imported directly via `import_html.py`, not connected to a database) does not need this marker.

---

## 10. Do / Don't quick reference

**Do**
- One `<section data-wbp-slide>` per slide, with a stable `data-slide-id`
- Build slide by slide from the material; make each page **one magazine-grade typeset web page** per `beautify/beautify-guide.md` (see §7.10, §12)
- Lead with the conclusion on the first slide (`data-zone="overview"`)
- Drive in-slide animation with `.is-active` CSS; use `data-wbp-fragment` for stepwise reveal
- Keep the speaker script in `<aside data-wbp-notes>` and hidden (150-300 characters per slide, see §5.1)
- Always implement a `prefers-reduced-motion` fallback
- Render every page as a standalone 1280×720 box; never overflow
- Delete all `data-wbp-source` material after building (see §12)
- Mark no-source data with `data-wbp-todo`, displaying "待补充"
- On dynamic data slides, add binding markers per `canonical-schema.md` §1.5.5 to elements sourced from (including statistically derived from) a database (static presentations exempt)

**Don't**
- Write JS for paging / stepwise reveal / autoplay (the container's responsibility)
- Put speaker narration into the body, or build visible "speaker notes" blocks (see §5.1)
- **Make pages into traditional PPT**: title + bullet lists, centered big titles with three equal columns, master-style uniform layouts
- Let adjacent pages repeat layouts
- Treat `data-layout` values as layout templates (they are content-type hints)
- Leave `data-wbp-source` material undeleted (= that page was never built)
- Exceed the 1280×720 box, or build cross-page / scroll-dependent layouts
- Fabricate numbers with no source
- Break the §7.10.3 shell and timing constraints (outer size changes / pre-hidden elements / frame-dropping animation)

---

## 11. meta JSON island (optional)

```json
{
  "title": "Q2 增长复盘",
  "audience": "boss",
  "scene": "report",
  "slideCount": 4,
  "slides": [
    { "id": "s1", "layout": "cover", "zone": "overview", "title": "核心结论", "sources": ["source.md#L1"], "todos": [] },
    { "id": "s2", "layout": "kpi", "zone": "data", "title": "核心指标", "sources": [], "todos": [] }
  ]
}
```

---

## 12. Baseline artifact form and building contract

> **Why the baseline emits no in-page content**: the moment the script ships in-page DOM and layout CSS, building degenerates into "recolor an existing layout" — every page comes out identical and PPT-flavored. So the **script emits only the frame**; layout design is fully delegated to the agent per `beautify/beautify-guide.md`.
>
> **One-line positioning**: this contract only guarantees the html's **outer frame adapts to presentation mode** (pageable, 16:9, has a presenter panel); **every page's content form is a magazine-grade typeset web page**, not a slide.

**The baseline artifact (`md_to_html.py --format presentation`) contains only**:

1. The root marker `<html data-wbp …>`, `<main data-wbp-deck>`, `#wbp-meta`;
2. Each slide's `<section data-wbp-slide>` shell (with `data-slide-id`/`data-layout`/`data-zone`/`data-transition`);
3. Each slide's `<script type="text/markdown" data-wbp-source>`: that page's md material (**unrendered**);
4. Each slide's `<aside data-wbp-notes>`: draft speaker script (hidden);
5. Frame-level CSS: `:root` variables (values are **achromatic placeholder gray**), the slide box's 1280×720 fix, `[data-wbp-notes]`/`[data-wbp-source]` hiding, `.is-active` animation keyframes, and the `reduced-motion` degradation.
   **No** in-page element layout styles, and **no** design decisions (colors / materials / radii / spacing systems).

**Agent building flow (per slide)**:

1. Pick the piece's tone and palette per the `beautify/beautify-guide.md` style routing, and **overwrite `:root`** (the placeholder gray must go).
2. Take that slide's `<script data-wbp-source>` text (a markdown fragment).
3. Per the guide, choose that page's section semantics, typography, and visuals; write the visible DOM inside that slide (the §7.10.2 16:9 adaptations apply simultaneously).
4. Write any needed styles into `<style>` (custom class names allowed), respecting §7.10.3.
5. Enrich that slide's `<aside data-wbp-notes>` script to 150-300 characters (see §5).
6. **Delete that page's `<script data-wbp-source>`**.
7. After all pages are done → run the beautify self-check list + the §7.10 post-build checks.

**Hard gates (machine-verifiable)**:

- The `data-wbp-source` hit count must be **0**, and every `data-wbp-slide` must contain visible DOM;
- `:root` must contain **no baseline placeholder gray residue** (`#8f8f8f` / `#121212` / `#1c1c1c`).

Residual material, an empty slide, or colors still in placeholder gray → **the artifact is not finished building and must not be imported**.
