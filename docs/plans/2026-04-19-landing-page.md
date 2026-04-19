# Landing Page Implementation Plan

**Goal:** Build a polished static landing page for Member Berries that explains the MCP/skill product and its food-science minimum viable nostalgia workflow.

**Architecture:** Use a single static HTML file under `docs/landing/index.html` with embedded CSS and no runtime dependencies. Keep README changes minimal and scoped to linking the landing page; do not add business-plan content to MCP docs.

**Tech Stack:** HTML, CSS, existing Node/npm verification scripts, existing package smoke checks.

---

### Task 1: Create the static page

**Files:**
- Create: `docs/landing/index.html`

**Steps:**
1. Add a responsive single-file page with hero, problem, workflow, food-science differentiator, example flows, host-AI/MCP boundary, install snippets, and trust boundaries.
2. Use embedded CSS only; no dependencies, no external fonts, no external images.
3. Keep copy accurate: host AI does search/browsing, MCP structures evidence and cue generation.

### Task 2: Link and package the page

**Files:**
- Modify: `README.md`
- Modify: `package.json`

**Steps:**
1. Add a small README link to `docs/landing/index.html` without changing README into a business plan.
2. Include `docs/landing/` in package `files` so the landing page ships with npm packaging.

### Task 3: Verify

**Commands:**
- `npm run check`
- `npm run package:smoke`
- `npm audit --audit-level=moderate`
- `npm pack --dry-run`
- `git diff --check`

**Expected:** all pass; package contents include the landing page.
