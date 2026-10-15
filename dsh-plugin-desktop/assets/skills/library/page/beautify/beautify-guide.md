# Document Beautification Spec (Visual Baseline for HTML View Generation)

Scope: this file is the design spec for turning content into magazine-quality HTML, covering only visual design methodology: role, narrative, theme routing, typography, visual techniques, anti-AI red lines, section semantics, content re-layout.

Boundary: this file is unaware of any upstream pipeline (intent routing, generator params, artifact forms, import/publish, player contracts). It is a referenced design spec only; upstream flows reference it and add their own constraints. Structural red lines for specific artifact forms (e.g. paginated presentations) live in their contract docs, not here.

The full CSS/HTML code library for advanced techniques is in `visual-techniques.md` in the same directory (usage rules in Advanced Visual Techniques below).

## Role

You are a visual design director — brand style expert plus document typographer — turning content into magazine-quality HTML. Core skills: content-structure extraction and narrative reorganization, brand visual language, premium surface materials, refined micro-interactions, rhythmic layout.

Design philosophy:
- Content is design: every visual decision serves content delivery; no meaningless decoration
- Restraint is premium: less is more; every kept element is polished
- Detail is attitude: a 1px border, 0.01em letter-spacing, a 4ms easing difference separate professional from amateur

## Core Narrative Logic

Beautification is "content is structure, structure is narrative". Arrange in this order:

1. Identify document type → match narrative skeleton
   - Report/proposal → problem → solution → data → conclusion
   - Manual/guide → overview → process breakdown → detail expansion → action
   - Resume/intro → identity anchor → data proof → experience narrative → contact
   - Courseware/lecture → problem definition → method → results → conclusion and outlook
2. Extract content structure → assign component forms
   - Parallel content → card grid, side-by-side comparison
   - Sequential content → timeline, step bars, big-number lists
   - Hierarchical content → indented lists, accordion
   - Opposing content → left-right split, comparison table
   - Single-point emphasis → full-width large type, oversized number banner
3. Determine visual style → apply design system: match temperament tags and palette to audience and scenario (see theme routing below)

## Global Constraints (Highest Priority)

Design variance controls — set these three axes per page from content temperament:
- `DESIGN_VARIANCE`: 5 (1=strictly symmetric, 10=artistic chaos) — document default 5 (restrained, not flashy)
- `MOTION_INTENSITY`: 4 (1=static, 10=cinematic) — document default 4 (fluid, never overpowering)
- `VISUAL_DENSITY`: 5 (1=gallery whitespace, 10=cockpit density) — informational docs 5~6, manuals 3~4

Visual style constraints:
- Body text uniformly `rgba(255,255,255,0.85)` (dark theme) or `rgba(0,0,0,0.95)` (light theme); brand color is forbidden for body text
- One accent color per page, functional emphasis only (CTA, active states), never decoration
- Gradients span at least 2 hues with varied directions; never all `to right`
- Dark themes: gradients only on the hero headline and CTA button, never as large background fills
- Spacing in 8px multiples only; card padding ≥ 16px; section spacing ≥ 48px

Anti-pattern red lines (common AI-page defects, all mandatory to avoid):
- No uniform text color: headlines bright, body at 0.85 opacity, secondary info 0.5
- No dark-theme cards lacking both border and shadow
- No identical gradient directions across the page
- No empty copy ("共创美好未来"); replace with concrete numbers and scenarios
- No CDN `@latest`; pin versions
- No pure black `#000000`; dark backgrounds must use off-black (e.g. `#08090a`, `#0d1117`)
- No oversaturated brand colors (saturation > 80%); the brand color should blend elegantly with neutrals
- No 3 equal-width card columns in a row (the most rampant AI pattern); use 2-column alternating, asymmetric grids, or horizontal scroll instead
- No slide-style layouts: "centered title + bullet list" on the same master layout every screen is PPT thinking, not magazine typography; pick section semantics per content structure and give each screen a distinct layout and visual anchor
- No hierarchy built by font size alone — use weight, color contrast, and spacing combined
- No AI-flavored generic names ("Acme", "Nexus", "SmartFlow"); use real context
- No filler words ("Elevate", "Seamless", "Unleash", "Next-Gen", "赋能", "抓手"); use concrete verbs
- No centered hero when DESIGN_VARIANCE > 4; use left-aligned, split-screen, or asymmetric whitespace structures
- No outer glow (neon glow); use inner borders or subtle tinted shadows instead
- No page relying only on the system font stack (`-apple-system` / `PingFang SC` / `Microsoft YaHei` / `sans-serif`) — that is the unprocessed baseline; import at least 1 webfont for the heading layer (see Font Selection)
- No dark theme where Inter is the only font — pair it with distinctive fonts such as Geist, Outfit, Satoshi

## Theme Routing

Autonomous judgment: derive the style from the source genre, tone, and audience clues; never throw temperament / palette / audience / scenario back at the user as questions. When clues are thin, default to the professional report/proposal entry and state the chosen style in one sentence in the reply; adjust on request. An explicit user choice always wins.

Match visual style strictly by document type and audience:

1. **Pitch deck / BP / fundraising — minimal precision** (ref Linear / Figma): background `#08090a`, brand purple `#a855f7` or blue `#3b82f6`.
2. **Professional report / proposal — trusted professional** (ref Stripe / Notion): background white `#ffffff` + `#f6f5f4`, brand blue `#0075de` or purple `#533afd`.
3. **Product / tool docs — tool aesthetic** (ref Raycast / Framer): background `#07080a`, brand signature color.
4. **Culture / lifestyle — warm living** (ref Airbnb): background white `#ffffff`, brand red `#ff385c` or warm tones.
5. **Data / content showcase — content immersion** (ref Spotify): background `#121212`, brand green `#1ed760` or brand color.
6. **Academic / education — clear professional** (ref Notion + Stripe): background white `#ffffff` + `#f6f8fa`, discipline color (sciences/humanities blue, arts custom).

### Font Selection

Changing the font is a hard requirement: the baseline ships only the system font stack (`-apple-system` / `PingFang SC` etc.), which is not a design choice. Every beautification must import at least 1 webfont and apply it to headings / hero — headings still on the system default stack count as unfinished font design. Body text may keep the system stack (Chinese readability first), but the heading layer (Display Hero / Section Heading) must use a distinctive font. Pick fonts from the theme routing, same as color: temperament decides the font.

Heading / body fonts by theme routing entry (temperament decides the font):

1. **Pitch deck / BP (minimal precision)**: headings Inter Variable 900 with negative tracking, or Outfit / Satoshi; body Inter Variable / Noto Sans SC.
2. **Professional report / proposal**: headings Plus Jakarta Sans 700, or DM Serif Display when gravitas is needed; body Plus Jakarta Sans / Noto Sans SC.
3. **Product / tool docs**: headings Geist / Outfit, with Geist Mono for data; body Inter Variable / Noto Sans SC.
4. **Culture / lifestyle**: headings Noto Serif SC, or Playfair Display / Cormorant Garamond; body Noto Sans SC.
5. **Data / content showcase**: headings Outfit / Satoshi, digits in Geist Mono `tabular-nums`; body Noto Sans SC.
6. **Academic / education**: headings Noto Serif SC or DM Serif Display; body Noto Sans SC.

- Chinese headings wanting an artistic / ceremonial feel: Noto Serif SC first; light modern feel: ZCOOL XiaoWei, fallback LXGW WenKai (霞鹜文楷, `@callmebill/lxgw-wenkai-web`, Lite build). Latin serifs like Playfair Display / Cormorant Garamond are for pure-English headings only — no CJK glyphs, Chinese falls back to system fonts; in mixed Chinese-English, declare the Chinese font alongside.
- Code / data: Geist Mono or `font-variant-numeric: tabular-nums` (monospaced digit alignment).
- `font-feature-settings: "cv01","ss03"` (Inter-only glyph tweaks); build hierarchy with weight contrast ≥ 300, see Typography System.
- Load via fontsource on `cdn.jsdelivr.net` with pinned versions. Chinese fonts: import exactly 1 weight (a single weight is ~1.5MB; multiple weights stack into MBs); Chinese body text falls back to system fonts, and hierarchy comes from size / color / spacing, not Chinese weights.

### Typography System (5 levels, exact parameters)

1. **Display Hero (hero headline)** — 48~72px / weight 700~900 / line-height 1.0~1.1 / letter-spacing -0.03em~-0.05em; large sizes get negative tracking (72px → -1.584px).
2. **Section Heading (section titles)** — 30~36px / weight 700 / line-height 1.2 / letter-spacing -0.02em (32px → -0.704px).
3. **Card Title (card titles)** — 18~20px / weight 600~700 / line-height 1.3 / letter-spacing normal.
4. **Body (body copy)** — 14~16px / weight 400 / line-height 1.6~1.8 / letter-spacing normal; ≤ 65 characters per line (peak readability).
5. **Caption (byline, date, tags)** — 12px / weight 400~500 / line-height 1.4 / letter-spacing 0.01em.

Hierarchy control: never rely on font-size gaps alone; build levels through weight × color contrast × spacing combined:
- Heading vs body: weight diff ≥ 300 + luminance diff ≥ 40% + spacing 24px
- Body vs caption: size diff ≥ 2px + opacity diff ≥ 0.3

### Spacing System (8px base unit, golden rhythm)

- 4px → icon-to-text gap
- 8px → inline element gaps
- 16px → card padding, list item gaps
- 24px → intra-section component gaps
- 32px → section content padding
- 48px → section spacing (mobile)
- 64px → section spacing (desktop)
- 96px → hero-to-content transition (breathing room)

Spacing rhythm: adjacent levels step by ≈ 1.5× (e.g. 16→24→32→48); avoid mechanical arithmetic progression.

## Mobile Adaptation Iron Rules (column degradation + fluid width)

Multi-column or large-size layouts must ship with mobile degradation — a page that looks fine on PC but explodes into horizontal scroll on phones is broken. The patterns below are hard requirements, checked by lint (`lint_page_quality.py` PQ201-205).

1. Multi-column grids must degrade to one column (most common failure: Bento Grid / ComparisonGrid / card grids):

```css
/* Standard: multi-column + breakpoint degradation */
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
@media (max-width: 640px) {
  .grid { grid-template-columns: 1fr; gap: 16px; }  /* must drop to one column on mobile */
}

/* Equivalent alternative: auto-fit columns (auto-degrades as container narrows, no @media needed) */
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; }

/* Anti-pattern: multi-column without degradation → three columns squeezed into a sliver on phones */
.grid { display: grid; grid-template-columns: repeat(3, 1fr); }
```

- Breakpoints: mobile `<640px` one column, tablet `640~1024px` two columns, desktop `>1024px` multi-column.
- 2-column Zig-Zag and left-right splits likewise: stack to `grid-template-columns: 1fr` on narrow screens.
2. Fluid widths, no hard-coded large px widths: containers use `max-width` + centering (e.g. `.wrap { max-width: 880px; margin: 0 auto; padding: 0 20px; }`), never `width: 800px`; inner elements use `%` / `fr` / `min()` / `clamp()`.
3. Images always constrained: CSS must contain `img { max-width: 100%; height: auto; }` (must not be lost when rewriting baseline CSS).
4. Large type uses clamp(): Hero / Display headings (≥40px) scale with the viewport via `clamp(28px, 5vw, 56px)`, never a fixed `font-size: 56px` (overflows small screens).
5. Wide tables scroll horizontally without breaking layout: table container gets `overflow-x: auto`; the table itself gets no fixed width.
6. Touch targets: clickable elements (buttons / links) have a minimum 44×44px hit area; hover effects need an `:active` or equivalent touch feedback.

## Advanced Visual Techniques

This section lists only the technique inventory and selection principles; the full paste-ready CSS/HTML for each technique lives in `visual-techniques.md` in the same directory. Usage:
1. Pick techniques here first: by page theme / accent color, choose 2~3 from the 7 systems below (more is over-design).
2. Then fetch code: `read_file` the matching section of `visual-techniques.md` (e.g. "1. Surface Materiality") and copy its CSS/HTML snippets.
3. Replace placeholders when applying: swap `品牌色R/G/B`, `主色A/B`, `#品牌主色` etc. in the code for the actual color values from this page's theme routing.
4. Restraint: techniques serve content — lower DESIGN_VARIANCE means fewer techniques; conflicts with the anti-pattern red lines resolve in favor of the red lines (e.g. no glowing borders, since outer glow is banned).

The 7 technique systems (code in the matching sections of `visual-techniques.md`):
1. Surface materials — glassmorphism / neumorphism / brand-color glowing borders / iridescent gradients
2. Shadow hierarchy — 4-level dark + Notion/Stripe light shadows
3. Layout aesthetics — asymmetric hero / Bento Grid / Zig-Zag alternating (no 3 equal columns)
4. Micro-interactions — 6 scroll entrance effects / haptic feedback / number counters / skeleton screens
5. Page rhythm — section breathing rules / visual anchor distribution / hero design principles
6. Color precision — full dark/light CSS variable systems / never mix warm and cold
7. Background ambiance — radial glows / dual light spots / noise texture (dark) / alternating sections (light)

## Component Templates

### Dark card

```css
/* Standard — precision style (Linear/Raycast) */
.doc-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.3s ease;
}
.doc-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  border-color: rgba(255, 255, 255, 0.12);
}

/* Advanced — glassmorphism */
.doc-card-glass {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 24px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
```

### Light card

```css
/* Standard — Notion style */
.doc-card-light {
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 24px;
  box-shadow:
    rgba(0,0,0,0.04) 0px 4px 18px,
    rgba(0,0,0,0.027) 0px 2px 8px,
    rgba(0,0,0,0.02) 0px 0.8px 3px;
}
```

### Buttons

- Only 1 primary CTA per page
- Dark CTA: gradient background + brand-color glow

```css
.cta-primary {
  background: linear-gradient(135deg, 主色A, 主色B);
  color: #ffffff;
  border-radius: var(--radius-full);
  padding: 16px 48px;
  font-weight: 600;
  box-shadow: 0 0 40px rgba(主色,0.4), 0 0 80px rgba(主色,0.2);
  transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.3s ease;
}
.cta-primary:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 0 48px rgba(主色,0.5), 0 0 96px rgba(主色,0.25);
}
.cta-primary:active {
  transform: translateY(0) scale(0.97);
}
```

- Light CTA: solid brand background + darker on hover

```css
.cta-primary-light {
  background: var(--primary);
  color: #ffffff;
  border-radius: var(--radius-sm);
  padding: 8px 16px;
  font-weight: 500;
  transition: background 0.2s;
}
.cta-primary-light:hover { background: var(--primary-hover); }
.cta-primary-light:active { transform: scale(0.97); }
```

## Content Processing Principles (re-layout first)

Core idea: you are a layout designer, not a photocopier. The source is raw material, not a client draft to reproduce 1:1.

- Compress: long paragraphs → distilled key sentences + keyword highlights; laundry lists → grouped and merged; repeated statements → said once.
- Rearrange: adjust order for visual rhythm; move highlights / data / conclusions up front into `QuoteBlock` / `DataHighlight`; fold detailed argumentation into `AccordionSection`.
- Density target: 3~5 effective information units per screen (100vh); when items exceed 6, consider merging, grouping, or switching to `ComparisonGrid` / `TimelineList`.
- Omit: pleasantries, transition filler, repeated definitions, off-topic tangents, long disclaimers — delete outright.
- Never omit: core data, key conclusions, factual details (names / dates / places), anything the user explicitly asked to keep.
- When the source exceeds ~3000 characters or ~12 items: default to summary mode — keep only the information skeleton (title + one-line summary + key data), demote the rest to appendix or omit, prioritizing generation speed and hero readability.

## Section Semantics

Organize every block with `<section>` + semantic class names (e.g. `class="doc-hero"`). Choose from these 10 section semantics only; inventing sections unrelated to the document structure is forbidden:

1. `DocHero` (cover): document title, subtitle, author, date, tags; the first-screen visual anchor
2. `SectionHeading`: numbered or icon-marked section title, optional description
3. `RichParagraph`: paragraphs with bold, links, inline code; the core body block
4. `ImageFrame`: image container with caption and title
5. `DataHighlight`: big-number display of key metrics and stats, with count-up animation
6. `QuoteBlock`: visual emphasis for key excerpts, punchlines, core conclusions
7. `TimelineList`: ordered processes, milestones, steps
8. `ComparisonGrid`: side-by-side comparison, option pros/cons
9. `AccordionSection`: step-by-step explanations, FAQs, expandable blocks (via `<details>` + `<summary>` or JS)
10. `DocFooter`: copyright, contact, reference links

Visual enhancement per section:
- `DocHero`: asymmetric layout (text left, decoration right), headline enters with blurIn, radial glow overlay in background
- `SectionHeading`: number in brand color + large size, title with negative tracking, description in text-secondary
- `DataHighlight`: digits in Geist Mono / tabular-nums + brand color + count-up animation, description in text-secondary
- `QuoteBlock`: 3px brand-color left border, body in serif (Noto Serif SC) for authority, surface background
- `TimelineList`: connector line as gradient (brand color to transparent), nodes filled with brand color
- `ComparisonGrid`: selected / recommended column highlighted with glow border, others standard border
- `AccordionSection`: content enters with blurIn on expand, height transition 300ms on collapse

## Tech Stack

- HTML5 + CSS3 (CSS variables + modern features: `backdrop-filter` / `clip-path` / `conic-gradient` etc.)
- Vanilla JavaScript (only for Intersection Observer entrances, number counters, accordion expand/collapse)
- Tailwind CSS (CDN, optional): layout atoms only (grid / flex / spacing); colors / shadows / radii must go through CSS variables
- Fonts: webfonts via fontsource (`cdn.jsdelivr.net`), pinned versions; Chinese headings limited to a single weight, body falls back to system fonts
- Theme switching: toggle `data-theme="dark|light"` on `<html>` + CSS variable overrides
- All CDN resources must pin versions; `@latest` forbidden

### CDN Whitelist (mandatory, CSP-enforced)

All external resources must come from these whitelisted domains; everything else is CSP-blocked (including `fonts.googleapis.com` / `font.im` / `bootcdn` / `staticfile` — none usable):

1. **Webfonts (Chinese & English)** — `cdn.jsdelivr.net` (fontsource: `@fontsource/<font>`).
2. **General npm libraries** — `cdn.jsdelivr.net` / `unpkg.com` / `esm.sh` (direct npm fetch with version).
3. **Common libraries, pinned** — `cdnjs.cloudflare.com` (explicit version).
4. **Tailwind** — `cdnjs.cloudflare.com` (tailwind.min.css, pinned version).

Font import example (a Chinese weight is ~1.5MB — import exactly 1; `chinese-simplified-<weight>.css` targets subset + weight, never the plain `<weight>.css` entry which pulls the full character set):

```html
<!-- English heading font: small package, multiple weights OK -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5.3.0/700.css">
<!-- Chinese heading font: exactly 1 weight -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.0/chinese-simplified-700.css">
```

Chinese body falls back to system fonts (`PingFang SC` / `Microsoft YaHei`) — regular and bold are free, no download cost; hierarchy comes from size / color / spacing, not Chinese webfont weights.

Advanced (when first-screen speed matters): use cn-font-split to split the Chinese font into 50~100KB `unicode-range` chunks, hosted on `cdn.jsdelivr.net` / `esm.sh` (both whitelisted); browsers fetch only the chunks actually used, cutting Chinese first-screen cost from ~1.5MB to tens of KB.

Tailwind import example:

```html
<link href="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css" rel="stylesheet">
```

## Beautification Quality Checklist

This checklist covers beautification quality only; procedural checks (library import, mounting, access URLs) follow the upstream process docs' own pre-reply checklists.

- [ ] Content re-laid-out (distilled / grouped / rearranged), no verbatim walls of text
- [ ] Fonts changed: ≥1 webfont imported (`<link>` present) and used in the heading layer's `font-family`, not just the system stack; Chinese serif headings use Noto Serif SC; mixed Chinese-English declares the Chinese font alongside
- [ ] Clear text hierarchy: headline → body → caption, three distinct colors
- [ ] Every card has border or shadow (never bare in dark themes)
- [ ] At least 2 gradient directions, not all identical
- [ ] All spacing in 8px multiples
- [ ] All interactive elements have hover/active states
- [ ] Hero fully visible within 100vh, no extra scrolling
- [ ] All CDN resources pinned, no `@latest`
- [ ] All external resources on whitelist domains only (`cdn.jsdelivr.net` / `cdnjs.cloudflare.com` / `unpkg.com` / `esm.sh`); no `googleapis` / `gstatic` / `font.im` / `bootcdn` or other non-whitelist domains
- [ ] Chinese webfont imports exactly 1 weight (via `chinese-simplified-<weight>.css`); Chinese body falls back to system fonts
- [ ] No AI flavor: no pure black, no outer glow, no 3 equal columns, no filler words
- [ ] No slide flavor: no "centered title + bullet list" layouts, no identical screen structures
