#!/usr/bin/env node
/**
 * Regenerates every derived logo file from ONE master image, so swapping the
 * logo is: replace the master, run this script, run `node scripts/hermes-plugin.mjs sync`.
 *
 * Master (first one found wins):
 *   branding/achiote.svg   (preferred: vector, crisp at every size)
 *   branding/achiote.png   (square, >= 1024 px)
 *
 * Derived files (all in branding/):
 *   achiote-512.png, achiote-192.png, achiote-128.png   square icons
 *   achiote-favicon.png (64 px), achiote-favicon.ico (16/32/48/64)
 *   achiote-banner.png  1200x600 (2:1) for the Hermes plugin catalog card
 *
 * Needs ImageMagick (`magick` or `convert`). Run by hand when the logo changes;
 * CI only checks that the plugin's copies match these files.
 *
 * Usage: node scripts/build-brand-assets.mjs [--background "#faf7f5"]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = path.join(ROOT, 'branding');
// Landing-page background token (docs/landing/manifest.json background_color).
const DEFAULT_BACKGROUND = '#faf7f5';

function imageMagick() {
  for (const bin of ['magick', 'convert']) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
      return bin;
    } catch {
      // try the next name
    }
  }
  throw new Error('ImageMagick is required (install it so `magick` or `convert` is on PATH).');
}

function findMaster() {
  for (const name of ['achiote.svg', 'achiote.png']) {
    const file = path.join(BRAND, name);
    if (fs.existsSync(file)) return file;
  }
  throw new Error('No master logo: add branding/achiote.svg (preferred) or branding/achiote.png.');
}

function main() {
  const args = process.argv.slice(2);
  const bgIndex = args.indexOf('--background');
  const background = bgIndex >= 0 ? args[bgIndex + 1] : DEFAULT_BACKGROUND;
  if (!/^#[0-9a-fA-F]{6}$/.test(background ?? '')) throw new Error('--background must be a #rrggbb color');

  const im = imageMagick();
  const master = findMaster();
  const isSvg = master.endsWith('.svg');
  // Rasterize SVGs at high density so downscales stay sharp.
  const input = isSvg ? ['-background', 'none', '-density', '1024', master] : [master];
  const run = (...ops) => execFileSync(im, [...input, ...ops], { stdio: 'inherit' });
  const out = (name) => path.join(BRAND, name);
  // -strip drops timestamps/metadata so re-running on the same master is byte-stable.
  const square = (size) => ['-resize', `${size}x${size}`, '-gravity', 'center', '-extent', `${size}x${size}`, '-strip'];

  for (const size of [512, 192, 128]) run(...square(size), out(`achiote-${size}.png`));
  run(...square(64), out('achiote-favicon.png'));
  run(...square(64), '-define', 'icon:auto-resize=64,48,32,16', out('achiote-favicon.ico'));
  run(
    '-resize', '440x440',
    '-background', background, '-gravity', 'center', '-extent', '1200x600',
    '-strip',
    out('achiote-banner.png')
  );

  console.log(`Brand assets rebuilt from ${path.relative(ROOT, master)}.`);
  console.log('Next: node scripts/hermes-plugin.mjs sync   (copies the icon + banner into plugins/achiote)');
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
