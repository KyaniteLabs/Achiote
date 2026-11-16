# Branding: where the logo lives and how to swap it

## Swap the logo in 3 commands

1. Put the new master in `branding/`:
   - `branding/achiote.svg` (**preferred**: vector, transparent background), or
   - `branding/achiote.png` (square, at least 1024×1024, **transparent background**).
   If you add an SVG, it wins over the PNG.
2. Rebuild every size and the plugin copies:
   ```bash
   node scripts/build-brand-assets.mjs     # needs ImageMagick
   node scripts/hermes-plugin.mjs sync
   ```
3. Re-cut the README hero and social cards (separate approved-asset step, below),
   check the hand-maintained slots, then run `npm run check`.

The current master (`branding/achiote.png`) has an opaque light-grey square behind
the mortar. On the catalog banner that square shows against the page colour, so the
new master should have a transparent background.

## README hero and social cards (separate approved-asset step)

`scripts/build-brand-assets.mjs` rebuilds only the square icons, the favicons and
the 2:1 catalog banner from `branding/achiote.png`. It does **not** touch the README
hero or the social cards: those are cut from the approved Chakra Petch lockup by the
brand owner, committed as approved assets, and `npm run check` neither regenerates
nor gates them. A logo swap is not finished until they are re-cut by hand:

- `branding/achiote-hero.webp` (1280×720) — the README header image.
- `branding/og.jpg` (1200×630) — the canonical website social card.
- `og-social-preview.png` (1280×720, repo root) — the GitHub social preview; commit
  it and upload it by hand in the repository settings.

## Every logo slot

| Slot | File | Updated by |
|---|---|---|
| Master | `branding/achiote.svg` or `branding/achiote.png` | you |
| README header | `branding/achiote-hero.webp` | separate approved-asset step (not `build-brand-assets.mjs`) |
| Square icons (512 / 192 / 128 px) | `branding/achiote-512.png`, `branding/achiote-192.png`, `branding/achiote-128.png` | `build-brand-assets.mjs` |
| Favicons | `branding/achiote-favicon.png`, `branding/achiote-favicon.ico` | `build-brand-assets.mjs` |
| Hermes catalog card (2:1) | `branding/achiote-banner.png` → `plugins/achiote/banner.png` | `build-brand-assets.mjs` + `hermes-plugin.mjs sync` |
| Plugin icon | `plugins/achiote/icon.png` (copy of `branding/achiote-512.png`) | `hermes-plugin.mjs sync` |
| Canonical website social card | `branding/og.jpg` | separate approved-asset step |
| GitHub social preview | `og-social-preview.png` | separate approved-asset step, then upload by hand |
| Deployed website social card | `docs/landing/og-image.jpg` (served as `/og-image.jpg`) | **by hand** |
| Landing favicon | `docs/landing/proof/favicon.svg` | **by hand** |
| Landing PWA icon | inline SVG in `docs/landing/manifest.json` | **by hand** |

The three hand-maintained website slots were not regenerated in the brand cutover
and still show the pre-cutover artwork (the PWA icon is the old three-circle mark).
Decide whether the new logo replaces those too, so the site, the README and the
Hermes card all match.

`npm run lint` fails if the plugin copies drift from `branding/`.
