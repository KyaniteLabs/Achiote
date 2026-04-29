# Achiote Landing Page — Full Copy + Design Audit
## Proposals for May 2026 "Amazing & Top of the Line"

---

## 1. Executive Summary

The current page has strong bones — a distinctive color system, a clever concept (Memory Receipts, minimum viable nostalgia cues), and a unique position (evidence-bounded food-memory reconstruction). But it reads like a spec document, not a product people fall in love with. The page tries to serve two audiences (developers and food-memory seekers) simultaneously and ends up underserving both. It also lacks the motion sophistication, typographic personality, social proof, and narrative flow that define top-tier 2026 landing pages.

**The single biggest problem:** No one knows who this is for in under 3 seconds.

**The single biggest opportunity:** The "One Seed, a Hundred Names" concept is genuinely brilliant and under-exploited — it could anchor the entire visual identity and differentiation strategy.

---

## 2. 2026 Landscape: What "Top of the Line" Means

Based on current landing page trends (Moburst, Landdding, GDJ, Rewebly, Ariel Digital — all 2026):

| 2026 Expectation | Current Status |
|---|---|
| Bold, oversized display typography (64–96px, variable fonts) | System font stack, fine but anonymous |
| Purposeful micro-interactions (hover feedback, form validation, button states) | Basic hover transforms only |
| Scroll-triggered narrative animation (scroll-timeline, view transitions) | Basic opacity fade reveal only |
| Bento grid or modular layouts | Standard card grids |
| Social proof with specificity (named quotes, data-backed stats) | **None whatsoever** |
| Glassmorphism / subtle depth effects | Has some (cards, header blur) |
| Dark-first or polished dark mode | ✅ Solid dark mode implementation |
| AI-readable structure (concise answer blocks, structured headings) | ✅ Good FAQPage schema, but could be tighter |
| Kinetic typography (1–2 restrained impact moments) | None |
| Single, outcome-driven hero with one CTA | Multiple CTAs, mixed audiences |
| Performance-first (sub-2s LCP) | Good (no heavy deps) |
| Trust-first design (transparent pricing, real screenshots) | Pricing is transparent but complex; no screenshots of actual product |

---

## 3. Design Audit

### 3.1 What's Working

- **Color system:** The achiote/warm palette (terracotta, saffron, sofrito green, mint) is distinctive and emotionally resonant. The naming convention for CSS variables is excellent.
- **Dark mode:** Properly designed, not an afterthought. The palette shift to deep browns with warm amber accents is well-executed.
- **Brand mark:** The conic-gradient logo is memorable. The "four continents" reference works.
- **Terminal blocks:** Strong developer aesthetic. The syntax highlighting adds polish.
- **Responsive behavior:** Clean breakpoints, mobile menu works.
- **Accessibility basics:** Skip link, focus-visible styles, prefers-reduced-motion support, semantic HTML.
- **Scroll reveal:** Functional, if basic.

### 3.2 What Needs Work

**A. Typography is anonymous for 2026.** A system font stack was acceptable in 2023. In 2026, top-tier landing pages use variable fonts with a display face for headlines and a complementary reading face. Without a custom typeface, the page lacks visual identity. The tight letter-spacing (`-0.06em`) on headings is doing good work, but the font itself has no character.

**Proposal:** Add a variable display font for H1/H2 (e.g., Switzer, Satoshi, or a licensed one like FK Grotesk Neue, or GT Super Display for editorial contrast). Keep the system stack for body text. This alone would transform the page's perceived quality tier.

**B. Motion language is stuck in 2022.** The page has exactly two animation patterns: hover transforms (`translateY(-4px)` + shadow boost) and scroll reveal (opacity + translateY fade-in). There are zero scroll-driven animations, no staggered reveals, no parallax, no kinetic type, no cursor effects.

**Proposal (specific, scoped additions):**

1. **Hero kinetic type:** Animate the headline words staggering in on load (opacity + clip-path reveal, ~400ms stagger). Degrades to static for reduced-motion.
2. **Scroll-driven parallax on hero image:** The hero image section below the fold slides at 0.85x scroll speed relative to surrounding content. Pure CSS via `animation-timeline: scroll()`.
3. **Staggered card reveals:** Replace the uniform `.reveal` class on card grids with staggered delays so cards cascade in rather than popping simultaneously.
4. **Micro-interactions on interactive elements:**
   - Button press states (scale to 0.97 on `:active`)
   - Pricing card hover lifts with subtle glow
   - FAQ items expand with height animation (not instant)
   - Terminal copy button with a "sparkle" confirmation
5. **Number counters in a new stats section** (or add to hero): "X memories reconstructed" animates upward on scroll into view.

All proposals degrade gracefully with `prefers-reduced-motion: reduce`.

**C. The hero image section is orphaned.** Currently: Hero section → separate section with just a full-width image → Names of Achiote section. The image has no relationship to surrounding content and breaks narrative momentum.

**Proposal:** Move the hero image into the hero section itself — either as a split layout background or as a bento-style inset within the hero grid. Alternatively, turn it into a parallax band that separates major content zones with a horizontal rule treatment.

**D. Layouts are repetitive.** Every section is "heading row + card grid." The page uses `grid-3`, `grid-2`, `examples`, `science-grid`, `install`, `pricing-grid`, `faq-grid` — all are essentially the same pattern with different column counts. This creates visual monotony.

**Proposal:** Introduce 2–3 layout pattern variations:
1. **Full-bleed section** with text overlay (for the Names of Achiote — make it a flowing horizontal marquee instead of a grid)
2. **Split panel** (text left, visual right — already used for science/terminal, good, keep it)
3. **Bento grid** (mixed-size cells, 2-col + 1-col + full-width cells — for the "different" section)
4. **Marquee/ribbon** (for the global names — infinite horizontal scroll at slow speed)

**E. No texture, no grain, no organic feel.** The ambient blobs are nice but pure CSS gradients feel synthetic. Top 2026 pages add SVG noise overlays, paper textures, or subtle grain to give warmth and tactility — especially important for a food product.

**Proposal:** Add a subtle SVG noise filter overlay (opacity ~0.03) over the page background. Apply it selectively to cards as well. This is a ~200 byte inline SVG filter — zero performance cost, huge perceptual upgrade.

**F. Header is functional but not premium.** The 72% opacity blur header works but lacks the glassmorphism polish expected in 2026 (border glow, subtle inner highlight, backdrop-saturate).

**Proposal:** Refine to full glassmorphism: `backdrop-filter: blur(20px) saturate(1.8); background: rgba(255,247,232,0.65); border-bottom: 1px solid rgba(255,255,255,0.3);` with a subtle inner box-shadow for edge definition.

**G. Footer is undercooked.** It's a standard 4-column link dump. No visual flair, no closing CTA, no personality.

**Proposal:** Add a closing statement above the link grid — a brief "last word" that reinforces the emotional hook. Something like: *"Some dishes only exist in memory now. Achiote helps you find them before they're gone."*

---

## 4. Copy Audit

### 4.1 What's Working

- **"Half-remembered family dish"** — strong, specific, emotional framing
- **"Memory Receipt"** — memorable, ownable concept name
- **Evidence separation** (user-said / inferred / researched / unknown) — genuinely distinctive, well-articulated
- **"The smallest taste that proves it"** — good shorthand for the MVNC concept
- **Names of Achiote section** — the strongest piece of copy on the page. The "every culture that encountered this seed gave it their own name" paragraph is genuinely moving.

### 4.2 What Needs Rewriting

**A. Audience schizophrenia.** The page oscillates between "You, a person with a half-remembered family dish" and "You, a developer who wants to wire this into Claude Code." These are two completely different journeys with different emotional states and different CTAs.

**Proposal:** Split into two clear pathways — surfaced immediately (hero or just below):
- **Path 1 (primary, B2C):** "Recover a lost family dish" → demo → examples → pricing → FAQ
- **Path 2 (secondary, B2D):** "Add food-memory tools to your AI agent" → install → docs → commercial pricing

This can be a simple section with two cards: "I want to find a dish" and "I want to build with it." The rest of the page flows from the primary path; secondary path links drill into developer-specific content.

**B. Hero is verbose and unfocused.**

Current eyebrow: `Food-memory forensics — Memory Receipt included`
Current headline: `Recover the taste of a half-remembered family dish. Then test one bite.`
Current paragraph: **52 words** across 3 sentences. Way too long for a hero.

**Proposal — tighten to under 30 words:**

```
Eyebrow: Food Memory Detective
Headline: Remember the dish. Find the taste. Test one bite.
         [or: "Your grandmother's recipe — reconstructed in one bite."
          or: "The dish you remember but can't name. The one bite that proves you found it."]

Subhead (max 20 words):
Achiote turns fragile food memories into structured research,
a Memory Receipt, and a cheap taste test — before anyone cooks a full recipe.
```

**C. "Honesty is part of the experience" is a terrible headline.** It frames the product's core value (evidence transparency) as a disclaimer rather than a feature. People don't get excited about "honesty" — they get excited about "certainty" or "trust."

**Proposal:** Reframe as:
> **Know what you know. See what you don't.**
> Achiote labels every claim so family members can correct the record — and no guess pretends to be a fact.

**D. "Why not just use ChatGPT or Google?" is defensive positioning.** Putting competitors in the reader's mind (especially free ones) triggers price anchoring and friction. The compare page is fine as a linked resource, but naming competitors on the main landing page is a conversion killer.

**Proposal:** Remove the "Why not just use..." card from the "different" grid. Replace with:
> **When search fails.**
> Recipe search works when you know the name. Achiote works when the memory is wrong, borrowed, half-forgotten, or in a language you don't speak.

Link to `/compare` if they want the deep-dive.

**E. "Illustrative demo" destroys credibility.** If something is illustrative (fake), don't showcase it. This is the landing page equivalent of "results not typical."

**Proposal:** Either:
1. Make it a real, working demo (best option)
2. Replace with a short Loom/walkthrough video showing the actual product
3. Replace with a "See it in action" section showing real Memory Receipt artifacts (like the sample-reconstruction-artifact.md)
4. Remove entirely if none of the above are feasible

**F. 5 pricing tiers is too many.** Free / Personal ($9/mo) / Memory Pack ($49 one-time) / Family Archive ($39/mo) / Commercial ($299+/mo). That's a cognitive load problem. Decision paralysis is real.

**Proposal:** Collapse to 3 tiers on the main page, with a "see all plans" link:
1. **Free** — 3 memories/month, try it out
2. **Personal** — $9/mo or $59/yr, 25 memories/month (position as "Most Popular")
3. **Family** — $39/mo, 300 memories/month, shared collections

Bury Memory Pack and Commercial behind a "All plans" toggle or separate page. Commercial especially should live on its own page with enterprise pricing detail.

**G. No social proof anywhere.** The page makes claims about reconstructing memories but shows zero evidence anyone has ever done it successfully. In 2026, social proof is the #1 trust signal on landing pages.

**Proposal:** Add at minimum:
- 2–3 named testimonials (even from beta users or personal use)
- A "reconstructed" counter: "X dish memories mapped and tested"
- If no users yet, use the author's own reconstructed dishes as case studies with specific details

**H. CTAs are inconsistent.** The page uses at least 5 different CTA labels: "Try the memory detective," "Open the food memory detective," "Try it live," "Read the docs," "Use the web demo," "Start free." This is brand-diluting and confusing.

**Proposal:** Standardize to 2 CTAs across the entire page:
- **Primary:** `Reconstruct a memory` or `Try it now` (links to /app)
- **Secondary:** `See a Memory Receipt` (links to sample artifact)
- **Developer only:** `Connect to your AI` (links to install section/docs)

---

## 5. Section-by-Section Proposals

### 5.1 Hero Section

| Element | Current | Proposed |
|---|---|---|
| Eyebrow | "Food-memory forensics — Memory Receipt included" | "Food Memory Detective" (clean, single concept) |
| H1 | "Recover the taste of a half-remembered family dish. Then test one bite." | "Remember the dish. Find the taste. Test one bite." or "Your grandmother's recipe — reconstructed in one bite." |
| Paragraph | 52 words, 3 sentences | 25 words, 1–2 sentences max |
| Primary CTA | "Try the memory detective" | "Reconstruct a memory" |
| Secondary CTA | "See a Memory Receipt" | Keep, it's good |
| Visual | Text left, memory card right | Add the hero image as the right-side visual (replace or augment the memory card). Add kinetic type entrance animation on H1. |
| Dark mode | Works | Works |

### 5.2 Hero Image (currently standalone section)

**Proposal:** Merge into the hero as the right-side visual, OR convert to a full-bleed parallax band between hero and names section with a subtle "scroll through" effect. Remove the empty-section wrapper around it.

### 5.3 Names of Achiote ("One Seed, a Hundred Names")

This section is the best thing on the page. Keep it. **Upgrade the layout:**

- Instead of a uniform 3-column card grid, **use a horizontal marquee/ribbon** at slow scroll speed (CSS scroll-driven animation). Each name card scrolls horizontally as the section stays in view.
- Or use a **bento-style mosaic** with varied card sizes — the most culturally significant names (Achiotl, Achiote, Urucum) get larger cards, secondary names get smaller ones.
- Add **native script rendering** (already done for Japanese, Hindi, Vietnamese — excellent). Make this the visual hook.

### 5.4 "Try It Now" Widget

**Current:** An input box + button. The JS picks a random canned response. It's essentially fake.

**Proposal:** Two options:
1. **Real demo:** Wire it to the actual MCP server / AI backend. Even a rate-limited version.
2. **Video walkthrough:** Replace with a 60-second video or animated GIF showing the real workflow: user types memory → AI asks questions → Memory Receipt appears → MVNC is generated. Embed via `<video>` with a poster frame showing the interface.

Do NOT keep a fake demo. It's actively harmful to trust.

### 5.5 "Food Memories Don't Start with a Recipe" (Problem Section)

Good section. Keep the H2. **Suggested copy tweaks:**

Current card #1: "The name may be wrong — or in another language"
→ Keep. Already implemented from prior proposal. Good.

Current card #2: "The trigger may be tiny"
→ Proposed: **"The memory is sensory, not semantic."** The thing that matters may be one browned edge, one spice bloom, one sour note, one chewy bite, or one table ritual.

Current card #3: "Guesses stay labeled"
→ Keep. It's the core USP.

### 5.6 "Not Recipe Search" (Different Section)

**Problem:** The "Why not just use ChatGPT or Google?" card is defensive and puts free competitors in the reader's mind.

**Proposed replacement for card #3:**
> **Built for fragments, not finished queries.**
> When the dish name is missing, when the memory comes through family language, when the strongest clue is sensory — that's when generic tools fail and Achiote's evidence structure takes over. [See how it works →]

Link to `/compare` rather than surfacing the comparison on the main page.

### 5.7 Workflow Section

**Good section. One issue:** Step 2 should say "Your host AI can search the web; Achiote plans the research strategy." This keeps the browsing boundary clear for a consumer audience.

**Proposal:** Rephrase for B2C audience (keep the agent split on a B2D variant):
> **2. Research the clues.** Achiote turns your fragments into a research plan — what to search, what to ask family members, what to verify. The AI does the legwork; Achiote keeps the trail.

### 5.8 Science Section

Strong section. The terminal with the MVNC JSON is a good visual anchor. Keep.

**Minor tweak:** The sources list is impressive but might overwhelm a casual reader. Consider collapsing into a `<details>` accordion with a summary: "View 7 cited food-science sources."

### 5.9 Examples

**Current issue:** "Illustrative demo" in the subhead.

**Proposal:** Remove "Illustrative demo." Replace with: "Each follows the same path: gather what someone remembers, research, find the sensory trigger, test it with one bite. Here's how it works with real memory fragments."

### 5.10 Install Section

**Current:** Generic "Add it to your AI agent."

**Proposal:** Add specific quick-start commands for top 3 platforms (Claude Code, Codex, Cursor) directly visible. The terminal block already does this — good. Add a "Not a developer? Use the web app" link below the terminal to catch non-dev visitors who scrolled this far.

### 5.11 Trust Section

**Current headline:** "Honesty is part of the experience."

**Proposal:** Change to: **"Know what you know. See what you don't."**

Keep the medical-boundary note concise and link to Safety for details. The food-science citation bullet covers credibility; it does not replace the disclaimer.

### 5.12 Pricing

**Proposal:** Reduce visible tiers from 5 to 3 (Free / Personal / Family). Add a subtle link: "Memory Packs, Family Sprints, and Commercial plans →" that scrolls to/highlights the full grid or links to a separate pricing page.

**Additional:** Add a **pricing trust element** — e.g., "No contracts. Cancel anytime." or "7-day refund on first month."

### 5.13 FAQ

**Current:** 6 questions. Good coverage.

**Tweak:** FAQ section headline currently says "What is Achiote?" in the section-head H2. That's a FAQ question acting as a section title. Change to something like **"Everything you need to know."** or **"Questions people actually ask."**

---

## 6. New Sections to Add

### 6.1 Social Proof / Trust Bar

Add a minimal trust section with:
- A counter: "X dish memories reconstructed" (animated on scroll)
- 2–3 short testimonials with names or initials
- If no real users yet, use a "Built on" or "Backed by" approach citing the research methodology and food-science grounding

Placement: Between examples and pricing, or immediately after the workflow.

### 6.2 Closing CTA Band

Currently, after FAQ, the page just… ends into the footer. No closing invitation.

**Proposal:** Add a narrow, warm CTA band between FAQ and footer:
> **Ready to find the dish you thought was lost?**
> [Reconstruct a memory →]

---

## 7. Technical Improvements (Performance & Polish)

| Item | Priority |
|---|---|
| Preload the hero image with `<link rel="preload" as="image">` | Medium |
| Add `fetchpriority="high"` to hero image | Low |
| Inline critical CSS (above-fold styles) into `<head>` for faster FCP | Medium |
| Replace `.reveal` JS approach with CSS `@view-transition` or `animation-timeline: view()` where supported, with JS polyfill fallback | Medium |
| Add `loading="lazy"` to below-fold images (hero image already has `loading="eager"` — good) | Already done |
| Reduce unused CSS (there are `.button.secondary` variants not used in all contexts, etc.) | Low |
| Add `width`/`height` attributes to images to prevent CLS | Medium |

---

## 8. Implementation Priority Matrix

Sorted by (Impact × Feasibility):

| # | Task | Impact | Effort |
|---|---|---|---|
| 1 | **Add a variable display font** for H1/H2 | ★★★★★ | ★★ |
| 2 | **Rewrite hero copy** (tighter headline, single CTA per audience) | ★★★★★ | ★ |
| 3 | **Split audience journeys** (two-path above or below fold) | ★★★★★ | ★★★ |
| 4 | **Fix or replace the fake demo** | ★★★★★ | ★★★★ |
| 5 | **Add social proof** (counter + 2–3 testimonials/quotes) | ★★★★ | ★★ |
| 6 | **Add SVG noise/grain texture** to backgrounds | ★★★★ | ★ |
| 7 | **Reduce pricing to 3 visible tiers** with "all plans" link | ★★★★ | ★ |
| 8 | **Add stagger reveals** to card grids | ★★★ | ★ |
| 9 | **Add kinetic type to hero H1** (entrance animation) | ★★★ | ★★ |
| 10 | **Refactor Names section layout** (marquee or bento grid) | ★★★ | ★★★ |
| 11 | **Upgrade header to full glassmorphism** | ★★ | ★ |
| 12 | **Add scroll-driven parallax** to hero image | ★★ | ★★ |
| 13 | **Add closing CTA band** before footer | ★★★ | ★ |
| 14 | **Rename "Honesty is part of the experience"** heading | ★★★ | ★ |
| 15 | **Remove "Why not just use ChatGPT/Google" from main page** | ★★★ | ★ |
| 16 | **Add preload hints and inline critical CSS** | ★★ | ★★ |
| 17 | **Add micro-interactions** (button press states, FAQ accordion, pricing hover glow) | ★★ | ★ |

---

## 9. The "One Big Swing" Option

If you did exactly one thing to transform this page, it would be:

**Make the "One Seed, a Hundred Names" concept the visual and conceptual spine of the entire page — not just one section.**

Build the page around the idea that *every food memory arrives the same way achiote seed names arrived — fragmented, borrowed, misspelled, half-remembered, carried across borders by people who didn't have the right word.* The names section isn't a fun fact; it's the product thesis made visible.

Visually, this means:
- The brand mark animation on scroll (the conic gradient morphs through the color spectrum of names)
- A flowing horizontal ribbon of names with native scripts that scrolls infinitely
- Each name card links to a "this is how Achiote would reconstruct a dish associated with this name" — tying the global identity directly to the product promise

This is not a small change. It's a re-anchoring of the entire narrative. But it's *the* thing that makes Achiote visually and emotionally unmistakeable in a sea of AI tools.

---

*Audit completed April 27, 2026. Research drawn from Moburst, Landdding, GDJ, Rewebly, Ariel Digital, TurboSEO, Medium (Brad Kinnard), and direct page analysis. 2026 trend claims are supported by 7+ industry sources published Q1 2026.*
