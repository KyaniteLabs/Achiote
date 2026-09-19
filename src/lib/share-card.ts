/**
 * Sanitized, public-facing share card.
 *
 * PRIVACY GUARANTEE (read this before editing):
 * `buildShareCard` reads ONLY from engine-generated, public food-science sources
 * — the curated, Crossref-verified mechanism database and the cue's public
 * title/goal. It has NO parameter for, and NO access to, the user's raw memory,
 * `userSaid`, `ruledOut`, inferred context, hypotheses, regions, occasions, or
 * any personal field. A share card is therefore provably personal-data-free by
 * construction: there is no code path that can leak a personal detail, because
 * no personal detail is ever in scope.
 *
 * The design intent (locked strategy, session 2026-06-23): Achiote is brand-led.
 * The shareable unit is a single verified food-science fact — not a personal
 * memory, not a permalink to someone's reconstruction. Sharing the science (with
 * a real DOI) is what pulls the next person in without ever weaponizing grief or
 * exposing a family's private heritage.
 */
import type { CitedMechanism, MinimumViableNostalgiaCue, ShareCard } from './types.js';

export type { ShareCard };

/** Maximum length for any single share-card text field (keeps cards legible). */
const MAX_FIELD_CHARS = 220;

/**
 * Collapse whitespace, strip control characters, and cap length. This is a
 * defensive hygiene pass only — the inputs are already clean engine output. It
 * exists so a malformed mechanism string can never produce a broken card.
 */
export function sanitizeShareCardText(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ') // control chars → word boundary
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FIELD_CHARS);
}

/**
 * Build a sanitized share card from public food-science sources.
 *
 * Returns `null` when there is no cited mechanism — a share card without a real,
 * Crossref-verified DOI would undercut the entire "cited = credible" thesis, so
 * we share nothing rather than an ungrounded claim. This null return is also the
 * opt-in gate: the client surfaces the "Share the science" button only when a
 * card exists.
 *
 * @param dishName A resolved public dish name (e.g. a hypothesis identity). Falls
 *   back to the mechanism slug. Never required to be personal.
 * @param cue      The minimum-viable-nostalgia cue (public title/goal only).
 * @param mechanisms Explicit mechanisms (e.g. from `retrieveMechanisms`). Falls
 *   back to `cue.citedMechanisms`.
 */
export function buildShareCard(input: {
  dishName?: string;
  cue?: MinimumViableNostalgiaCue;
  mechanisms?: CitedMechanism[];
}): ShareCard | null {
  const mechanisms = input.mechanisms ?? input.cue?.citedMechanisms ?? [];
  if (mechanisms.length === 0) return null;

  const top = mechanisms[0];
  const fact = sanitizeShareCardText(top.practicalImplication || top.summary);
  if (!fact) return null;

  const dishName = sanitizeShareCardText(input.dishName) || sanitizeShareCardText(top.slug) || 'A food memory';

  const cueTitle = sanitizeShareCardText(input.cue?.title) || undefined;
  const cueGoal = sanitizeShareCardText(input.cue?.goal) || undefined;

  return {
    dishName,
    fact,
    doi: top.doi,
    citation: sanitizeShareCardText(top.citation),
    ...(cueTitle ? { cueTitle } : {}),
    ...(cueGoal ? { cueGoal } : {}),
  };
}

/**
 * The plain-text payload for `navigator.share({ text })` / clipboard fallback.
 * Intentionally short and DOI-forward: the citation IS the credibility.
 */
export function formatShareCardText(card: ShareCard): string {
  return [
    `${card.dishName} — the food science, verified`,
    '',
    card.fact,
    card.cueGoal ? `\nTry it: ${card.cueGoal}` : '',
    `\nVerified source: doi:${card.doi}`,
    '\nRecovered with Achiote → achiote.kyanitelabs.tech',
  ].join('');
}

/** Short title for `navigator.share({ title })`. */
export function formatShareCardTitle(card: ShareCard): string {
  return `${card.dishName} — verified food science`;
}

/**
 * XML-escape a string for safe interpolation into an SVG document.
 */
function svgEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Word-wrap text to a max character width for SVG <tspan> line breaking. */
function wrapText(text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > width ? `${last.slice(0, width - 1)}…` : last;
  }
  return lines;
}

/**
 * Render a branded share card as a dependency-free SVG string (1200×630, OG-safe
 * aspect). Served/used as an in-app preview and screenshot target. The cobalt +
 * cream palette matches the Achiote brand. No personal data appears — only the
 * public dish name, the verified fact, and the DOI.
 */
export function buildShareCardSvg(card: ShareCard): string {
  const ACCENT = '#c2410c'; // achiote seed
  const INK = '#2a2521';
  const BG = '#faf7f2'; // cream
  const SOFT = '#6f655c';

  const factLines = wrapText(card.fact, 52, 3);
  const factSpans = factLines
    .map((line, i) => `<tspan x="80" dy="${i === 0 ? 0 : 34}">${svgEscape(line)}</tspan>`)
    .join('');

  const cueLine = card.cueGoal
    ? `<text x="80" y="${380}" font-family="Georgia, serif" font-size="22" fill="${SOFT}">${svgEscape(wrapText(card.cueGoal, 56, 1)[0] ?? '')}</text>`
    : '';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${svgEscape(formatShareCardTitle(card))}">`,
    `<rect width="1200" height="630" fill="${BG}"/>`,
    `<rect x="0" y="0" width="14" height="630" fill="${ACCENT}"/>`,
    `<text x="80" y="120" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="2" fill="${ACCENT}">ACHIOTE</text>`,
    `<text x="80" y="200" font-family="Georgia, serif" font-size="52" font-weight="700" fill="${INK}">${svgEscape(card.dishName)}</text>`,
    `<text x="80" y="270" font-family="Georgia, serif" font-size="30" fill="${INK}">${factSpans}</text>`,
    cueLine,
    `<text x="80" y="560" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="22" fill="${SOFT}">Verified source · doi:${svgEscape(card.doi)}</text>`,
    `<text x="1120" y="560" text-anchor="end" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="22" fill="${SOFT}">achiote.kyanitelabs.tech</text>`,
    `</svg>`,
  ].join('');
}
