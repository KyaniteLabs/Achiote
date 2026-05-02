# Achiote Agent Guardrails

This repository is a **Model Context Protocol server + skill** for research-first food-memory reconstruction. Keep it small, trustworthy, and mechanism-driven.

## Product boundaries

- The host AI does open-ended web/search research. The MCP server structures memory intake, research plans, provenance, dossiers, sensory reasoning, sourcing prompts, and minimum viable nostalgia cues.
- Do **not** add browsing, scraping, geocoding, grocery inventory, price lookup, or live provider calls without an explicit privacy/security design and recorded fixtures.
- The README is for MCP/skill usage. Do **not** add SaaS, investor, meal-kit, or business-plan material to the README.
- The landing page may be product-facing, but keep implementation dependency-free unless explicitly approved.

## Minimum viable nostalgia cue rules

Minimum viable cues must be:

1. **Cheap** — tiny quantities, pantry/grocery-store substitutes first.
2. **Accessible** — no exact specialty ingredient as the first move.
3. **Food-science grounded** — explain aroma, fat, Maillard/browning, starch texture, sauce balance, acid/sugar/salt, temperature, and texture contrast.
4. **Evidence-bounded** — use `userSaid`, researched facts, inferred facts, and unknowns separately.
5. **Not dish-specific** — do not add country/dish/restaurant/recipe branches inside `generateMinimumViableNostalgiaCue` or its helper profile logic. Add reusable mechanisms instead.

## Code conventions

- No new runtime dependencies without explicit approval.
- Prefer typed schemas and tests over prose-only behavior changes.
- Keep host prompts bounded and quote user fields as data, not instructions.
- Do not weaken provenance validation.
- Do not remove `structuredContent`; display text may be concise, but structured data is the contract.

## Required verification before PR/merge

Run:

```bash
npm run check
npm run package:smoke
npm audit --audit-level=moderate
git diff --check
```

For package-affecting changes, also run:

```bash
npm pack --dry-run
```

For landing-page visual changes, open the changed public routes in a browser and note whether screenshot/visual review was or was not performed. Route-affecting launch changes should consider `/`, `/app`, `/pricing`, `/about`, `/roadmap`, `/changelog`, `/status`, `/blog`, `/receipt`, `/privacy`, `/terms`, `/safety`, and `/support`.
