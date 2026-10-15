# Advanced Visual Techniques

Pick techniques on demand — enable at most 2~3 per page, otherwise the design becomes overdone.
This file is the code library for `beautify-guide.md` §Advanced Visual Techniques; load the specific CSS/HTML snippets on demand when generating HTML.

---

## 1. Surface Materiality

**Glassmorphism** — for dark-theme data cards and sidebars
```css
/* True glassmorphism = blur + translucent fill + inner border highlight + outer shadow */
background: rgba(255, 255, 255, 0.05);
backdrop-filter: blur(16px);
-webkit-backdrop-filter: blur(16px);
border: 1px solid rgba(255, 255, 255, 0.1);
box-shadow: 
  0 8px 32px rgba(0, 0, 0, 0.3),   /* spatial depth */
  inset 0 1px 0 rgba(255, 255, 255, 0.1); /* edge refraction highlight */
border-radius: 12px;
```
The `inset 0 1px 0` white inner shadow is required — it simulates physical edge refraction; without it you only get blur, not glass.

**Neumorphism** — for light-theme tool panels and settings areas
```css
/* Raised — element shares the background color; depth comes from dual shadows */
background: #e0e5ec; /* background must be neither pure white nor pure black */
box-shadow: 
  8px 8px 16px rgba(0, 0, 0, 0.15),   /* bottom-right dark shadow */
  -8px -8px 16px rgba(255, 255, 255, 0.7); /* top-left light shadow */

/* Inset — inputs, selected states */
box-shadow: 
  inset 4px 4px 8px rgba(0, 0, 0, 0.12),
  inset -4px -4px 8px rgba(255, 255, 255, 0.6);
```

**Glow Border** — for dark-theme key data cards and selected states
```css
/* Inner glow ×2 + outer ambient light */
border: 1px solid rgba(品牌色R, 品牌色G, 品牌色B, 0.3);
box-shadow: 
  inset 0 0 6px rgba(品牌色R, 品牌色G, 品牌色B, 0.15),  /* inner glow layer 1 */
  inset 0 0 12px rgba(品牌色R, 品牌色G, 品牌色B, 0.08), /* inner glow layer 2 */
  0 0 24px rgba(品牌色R, 品牌色G, 品牌色B, 0.12);       /* outer ambient light */
```

**Iridescent Gradient** — hero background decoration only; never cover large areas
```css
background: conic-gradient(
  from 0deg,
  rgba(255, 50, 100, 0.15),
  rgba(255, 150, 50, 0.15),
  rgba(200, 255, 50, 0.15),
  rgba(50, 255, 150, 0.15),
  rgba(50, 150, 255, 0.15),
  rgba(150, 50, 255, 0.15),
  rgba(255, 50, 100, 0.15)
);
filter: blur(80px); /* heavy blur = organic glow, not harsh color blocks */
```

---

## 2. Shadow Hierarchy

Dark-theme shadows (never pure black `rgba(0,0,0,1)`; use dark tones tinted toward the brand color):
```css
/* Level 1 — light float (tags, small cards) */
box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);

/* Level 2 — standard cards */
box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);

/* Level 3 — popovers/modals */
box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);

/* Level 4 — layers over fullscreen overlays */
box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
```

Light-theme shadows (Stripe style, blue-tinted brand shadows):
```css
/* Notion style — 4 ultra-light shadow layers (most refined) */
box-shadow:
  rgba(0,0,0,0.04) 0px 4px 18px,
  rgba(0,0,0,0.027) 0px 2px 8px,
  rgba(0,0,0,0.02) 0px 0.8px 3px,
  rgba(0,0,0,0.01) 0px 0.175px 1px;

/* Stripe style — blue-tinted brand shadow */
box-shadow:
  rgba(50, 50, 93, 0.25) 0px 30px 45px -30px,
  rgba(0, 0, 0, 0.1) 0px 18px 36px -18px;
```

---

## 3. Layout Aesthetics

**Asymmetric Hero** (instead of a centered headline):
```html
<!-- Left text / right visual — more editorial (grid-cols-5: left 60%, right 40%) -->
<div class="grid grid-cols-1 lg:grid-cols-5 gap-8 items-center">
  <div class="lg:col-span-3"><!-- left 60%: text --></div>
  <div class="lg:col-span-2"><!-- right 40%: visual --></div>
</div>
```

**Bento Grid** (Apple Control Center style info section):
```html
<!-- Non-uniform grid — mixed card sizes give information density rhythm -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
  <div class="col-span-2 row-span-2"><!-- large card --></div>
  <div><!-- small card --></div>
  <div><!-- small card --></div>
  <div class="col-span-2"><!-- wide card --></div>
</div>
```

**2-column Zig-Zag** (instead of 3 equal columns):
```html
<!-- Odd rows: visual left / text right; even rows flipped via dir="rtl" -->
<div class="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
  <div><!-- visual --></div>
  <div><!-- text --></div>
</div>
<div class="grid grid-cols-1 md:grid-cols-2 gap-8 items-center" dir="rtl">
  <div><!-- visual --></div>
  <div><!-- text --></div>
</div>
```

**Max content width**: center all content within `max-w-6xl` (1152px) to avoid stretching on ultra-wide screens.

---

## 4. Micro-Interaction Upgrade

**Scroll entrance animations (4 standard + 2 advanced):**
```js
// Standard entrances — driven by Intersection Observer
const animations = {
  fadeUp:     'opacity: 0; transform: translateY(24px)',   // fade in and rise
  stagger:    'opacity: 0; transform: translateY(16px)',   // staggered fade (children get increasing delay)
  slideLeft:  'opacity: 0; transform: translateX(-32px)',  // slide in from left
  scaleIn:    'opacity: 0; transform: scale(0.92)',        // scale pop-in
  // Advanced
  clipReveal: 'clip-path: inset(0 100% 0 0)',              // clip reveal (good for images)
  blurIn:     'opacity: 0; filter: blur(8px)',             // blur-to-focus (good for headings)
};
// Final state for all: opacity: 1; transform: none; filter: none;
// transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1); // easeOutExpo
```

**Stagger delay formula**: `delay = index * 80ms` (total delay must not exceed 400ms)

**Haptic feedback** (all clickable elements):
```css
.interactive {
  transition: transform 0.15s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.2s ease;
}
.interactive:hover {
  transform: translateY(-2px);     /* slight lift */
  box-shadow: 0 8px 24px rgba(0,0,0,0.2); /* deepened shadow */
}
.interactive:active {
  transform: translateY(0) scale(0.97); /* press bounce-back */
  transition-duration: 0.08s;            /* fast response */
}
```

**Count-up number animation** (data highlight sections only):
```js
// Use requestAnimationFrame for smooth counting
// easing: easeOutExpo — fast first then slow, number runs from 0 to target
// duration: 2000ms, delay: starts 200ms after the element enters the viewport
```

**Skeleton shimmer**: use shimmering placeholders for loading states, not spinners
```css
.skeleton {
  background: linear-gradient(90deg, 
    rgba(255,255,255,0.04) 25%, 
    rgba(255,255,255,0.08) 50%, 
    rgba(255,255,255,0.04) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

---

## 5. Visual Rhythm & Breathing

**Section breathing rule**: not every section should be the same length — follow long sections with short ones, and dense information with whitespace transitions.

```
Ideal rhythm pattern:
Hero (fullscreen impact) → short data strip (3 numbers) → long content section (3~4 screens)
→ short quote/pull-quote (1 screen of whitespace) → medium content section (2 screens) → short CTA close
```

**Visual anchor distribution**: after every 2~3 text-heavy sections, insert a visual anchor:
- Full-width quote block (QuoteBlock: large text + brand-colored left border)
- Data highlight banner (DataHighlight: big numbers + description)
- Image (ImageFrame: breaks up pure-text rhythm)

**Above-the-fold principles**:
- No scrollbar in the first viewport — all core information fits within 100vh
- Don't center the headline — left-aligned, or a split structure (left text + right visual) feels more editorial
- Subtitle/description follows the headline with 16px spacing, forming a compact information unit
- The hero CTA button sits 32px below the headline, not at the bottom of the page

---

## 6. Color Precision

**Dark theme — full CSS variable system**:
```css
:root {
  /* Base palette */
  --primary: #品牌主色;            /* the only accent color, saturation < 80% */
  --primary-hover: 品牌色加深10%;   /* CTA hover */
  --primary-glow: rgba(品牌色, 0.15); /* glow effects only */

  /* Neutral scale (cool or warm; consistent across the page, never mixed) */
  --bg: #08090a;                    /* off-black, not pure black */
  --bg-elevated: #0d0f14;           /* popover/modal background */
  --surface: rgba(255,255,255,0.03); /* card background */
  --surface-hover: rgba(255,255,255,0.06); /* card hover */
  --border: rgba(255,255,255,0.08); /* standard border */
  --border-strong: rgba(255,255,255,0.15); /* emphasized border */

  /* Text scale (3 levels; must be used together for hierarchy) */
  --text: rgba(255,255,255,0.85);     /* body */
  --text-secondary: rgba(255,255,255,0.55); /* secondary info */
  --text-tertiary: rgba(255,255,255,0.35);  /* timestamps, placeholders */

  /* Functional colors */
  --success: #34d399;
  --warning: #fbbf24;
  --error: #f87171;

  /* Radii */
  --radius-sm: 6px;   /* small elements: tags, badges */
  --radius: 8px;      /* standard: cards, inputs */
  --radius-lg: 12px;  /* large cards, panels */
  --radius-xl: 16px;  /* hero cards, modals */
  --radius-full: 9999px; /* pill buttons */
}
```

**Light theme — full CSS variable system**:
```css
:root {
  --primary: #品牌主色;
  --primary-hover: 品牌色加深8%;
  --bg: #ffffff;
  --bg-elevated: #f6f5f4;           /* Notion warm-white alternation */
  --surface: #ffffff;
  --surface-hover: #f9fafb;
  --border: rgba(0,0,0,0.08);
  --border-strong: rgba(0,0,0,0.15);
  --text: rgba(0,0,0,0.95);
  --text-secondary: rgba(0,0,0,0.55);
  --text-tertiary: rgba(0,0,0,0.35);
  --success: #059669;
  --warning: #d97706;
  --error: #dc2626;
  --radius-sm: 4px;
  --radius: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
}
```

**Color consistency rule**: pick either cool or warm tones for the whole page; never mix cool and warm grays on the same page.

---

## 7. Background Atmosphere

Dark themes should not use flat solid backgrounds — layer in subtle atmosphere:
```css
/* Option A: radial gradient glow */
background: 
  radial-gradient(ellipse 80% 50% at 50% -20%, rgba(品牌色,0.12), transparent),
  #08090a;

/* Option B: dual light spots */
background:
  radial-gradient(ellipse 60% 40% at 20% 0%, rgba(品牌色,0.08), transparent),
  radial-gradient(ellipse 50% 50% at 80% 100%, rgba(品牌色,0.05), transparent),
  #08090a;

/* Option C: noise texture overlay (most advanced) */
background:
  url("data:image/svg+xml,<svg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.03'/></svg>"),
  radial-gradient(ellipse 80% 50% at 50% -20%, rgba(品牌色,0.12), transparent),
  #08090a;
```

Light themes alternate section backgrounds:
```css
/* Notion style: white → warm gray → white alternation */
.section:nth-child(odd) { background: #ffffff; }
.section:nth-child(even) { background: #f6f5f4; }
```
