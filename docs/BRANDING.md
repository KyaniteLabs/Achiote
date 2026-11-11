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
3. Check the slots below that the script does not cover, then run `npm run check`.

The current master (`branding/achiote.png`) has an opaque light-grey square behind
the mortar. On the catalog banner that square shows against the page colour, so the
new master should have a transparent background.

## Every logo slot

| Slot | File | Updated by |
|---|---|---|
| Master | `branding/achiote.svg` or `branding/achiote.png` | you |
| README header | `branding/achiote-512.png` | `build-brand-assets.mjs` |
| App icons | `branding/achiote-192.png`, `branding/achiote-128.png` | `build-brand-assets.mjs` |
| Favicons | `branding/achiote-favicon.png`, `branding/achiote-favicon.ico` | `build-brand-assets.mjs` |
| Hermes catalog card (2:1) | `branding/achiote-banner.png` → `plugins/achiote/banner.png` | `build-brand-assets.mjs` + `hermes-plugin.mjs sync` |
| Plugin icon | `plugins/achiote/icon.png` | `hermes-plugin.mjs sync` |
| Landing favicon | `docs/landing/proof/favicon.svg` | **by hand** |
| Landing PWA icon | inline SVG in `docs/landing/manifest.json` | **by hand** |
| Social card | `docs/landing/og-image.jpg` | **by hand** |

The last three slots currently use a **different mark** (three overlapping circles)
from the mortar in `branding/`. Decide whether the new logo replaces those too, so the
site, the README and the Hermes card all match.

`npm run lint` fails if the plugin copies drift from `branding/`.
