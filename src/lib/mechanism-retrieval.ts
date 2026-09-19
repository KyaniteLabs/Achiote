/**
 * Engine grounding — keyword retrieval over the curated, Crossref-verified
 * food-science reference database (`src/data/food-science-references.json`).
 *
 * The deterministic cue engine produces lowercased `signals` (the user's memory
 * plus dossier text). This module scores every cited mechanism against those
 * signals by simple token overlap — no embeddings, no dependencies — and returns
 * the best matches so the answer can cite a real DOI instead of leaning on the
 * model's own knowledge. The approach mirrors `scripts/diagnose.mjs`: tag terms
 * weigh more than prose, and a compact layperson→science synonym map bridges
 * everyday words ("whisky", "boozy", "ice") to the database's scientific
 * vocabulary ("ethanol", "spirits", "dilution").
 *
 * The JSON is loaded via an ESM import attribute, the same way the rest of the
 * runtime loads `src/data/*.json`, so `tsc` copies it into `dist/data/` and it
 * resolves from the built app, not just from tests.
 */
import type { CitedMechanism } from './types.js';
import referencesData from '../data/food-science-references.json' with { type: 'json' };

export type { CitedMechanism };

type MechanismSource = {
  id?: string;
  citation?: string;
  doi?: string;
  keyFindings?: string[];
};

type MechanismEntry = {
  summary?: string;
  practicalImplication?: string;
  sources?: MechanismSource[];
  coverageMechanisms?: string[];
};

// Common English words that carry no retrieval signal. Kept small on purpose.
const STOP_WORDS = new Set([
  'this', 'that', 'with', 'from', 'your', 'over', 'about', 'which', 'their',
  'they', 'them', 'than', 'then', 'into', 'some', 'more', 'most', 'have',
  'will', 'also', 'when', 'what', 'were', 'been', 'being', 'only', 'such',
  'very', 'both', 'each', 'these', 'those', 'used', 'like', 'just', 'much',
  'remember', 'remembered', 'memory', 'taste', 'tasted', 'smell', 'smelled',
  // Generic outcome words: every dish has "flavor" and "color", so they carry no
  // discriminative signal — and (worse) they appear inside compound coverage tags
  // like `cation_flavor_binding` and slugs like `retronasal-olfaction-flavor`,
  // producing weight-3 tag hits that clear the precision gate and cite unrelated
  // papers (e.g. coffee-extraction chemistry grounding a purple-yam dessert).
  'flavor', 'flavour', 'flavors', 'flavours', 'color', 'colour', 'colors', 'colours',
  // Question/instruction filler that carries no dish signal ("what MAKES it", "the FIRST taste").
  'makes', 'make', 'making', 'first',
]);

// Compact layperson → food-science vocabulary bridge. Everyday memory words
// rarely match the database's scientific tags directly, so we expand a few
// high-value drink/cooking terms to the words the references actually use.
const SYNONYM_EXPANSIONS: Record<string, string[]> = {
  whisky: ['ethanol', 'spirits', 'dilution'],
  whiskey: ['ethanol', 'spirits', 'dilution'],
  bourbon: ['ethanol', 'spirits'],
  scotch: ['ethanol', 'spirits'],
  booze: ['ethanol', 'spirits'],
  boozy: ['ethanol', 'spirits'],
  alcohol: ['ethanol', 'spirits'],
  alcoholic: ['ethanol'],
  liquor: ['spirits', 'ethanol'],
  spirit: ['spirits', 'ethanol'],
  ice: ['dilution', 'temperature'],
  iced: ['dilution', 'temperature'],
  watered: ['dilution'],
  diluted: ['dilution'],
  beer: ['beer', 'fermentation'],
  wine: ['wine', 'fermentation'],
  smoky: ['smoke', 'maillard'],
  charred: ['maillard', 'browning'],
  seared: ['maillard', 'browning'],
  toasted: ['maillard', 'browning'],
  crispy: ['maillard', 'browning'],
  sour: ['acid', 'fermentation'],
  tangy: ['acid', 'fermentation'],
  fizzy: ['carbonation', 'co2'],
  bubbly: ['carbonation', 'co2'],
};

// A coverage-tag hit weighs 3; below that the overlap is incidental prose words.
// Cite nothing rather than a tangential paper — a wrong citation is worse than none.
const MIN_RELEVANCE_SCORE = 3;
// A secondary citation must score within this fraction of the top match to be shown,
// so a single weak shared tag (e.g. "spirits" matching both whisky-dilution AND agave)
// can't ride along next to a strong, clearly-relevant match.
const SECONDARY_MARGIN = 0.5;
// Corroboration gate: a single coincidental word (e.g. the generic "sweet" that fits
// any dessert, matching a `..._sweet_..` tag for 3 points) must not cite on its own.
// Require at least two DISTINCT matched terms so one accidental tag hit can't ground
// an unrelated paper (the coffee-extraction-for-purple-yam failure mode).
const MIN_DISTINCT_TOKENS = 2;

function isUsefulToken(word: string): boolean {
  return word.length >= 4 && !STOP_WORDS.has(word);
}

/** Tokenize free text into the >=4-char, non-stopword terms used for scoring. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter(isUsefulToken);
}

/** Signal tokens plus their synonym expansions (expansion runs on every raw word). */
function signalTokenSet(signals: string): Set<string> {
  const rawWords = signals.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const tokens = new Set(rawWords.filter(isUsefulToken));
  for (const word of rawWords) {
    for (const expansion of SYNONYM_EXPANSIONS[word] ?? []) tokens.add(expansion);
  }
  return tokens;
}

/** High-weight terms for a mechanism: its coverage tags plus its own slug words. */
function tagTermSet(slug: string, entry: MechanismEntry): Set<string> {
  const terms = [
    ...(entry.coverageMechanisms ?? []).flatMap((tag) => tag.toLowerCase().split(/[_-]/)),
    ...slug.toLowerCase().split('-'),
  ].filter(isUsefulToken);
  return new Set(terms);
}

/** Lower-weight terms for a mechanism: words from its summary + practical implication. */
function proseTermSet(entry: MechanismEntry): Set<string> {
  return new Set(tokenize(`${entry.summary ?? ''} ${entry.practicalImplication ?? ''}`));
}

/**
 * Score every cited mechanism by token overlap with the (synonym-expanded)
 * signals and return the top `limit` matches with score > 0. Tag hits weigh 3,
 * prose hits weigh 1. Returns an empty array when the database, mechanisms, or
 * sources are missing so the caller can degrade gracefully.
 */
export function retrieveMechanisms(signals: string, limit = 3): CitedMechanism[] {
  const mechanisms = (referencesData as { mechanisms?: Record<string, MechanismEntry> })?.mechanisms;
  if (!mechanisms || typeof mechanisms !== 'object') return [];

  const signalTokens = signalTokenSet(signals);
  if (signalTokens.size === 0) return [];

  const scored: Array<{ mechanism: CitedMechanism; score: number; matchedTokens: number }> = [];
  for (const [slug, entry] of Object.entries(mechanisms)) {
    const source = entry.sources?.[0];
    if (!source?.citation || !source?.doi) continue;

    const tagTerms = tagTermSet(slug, entry);
    const proseTerms = proseTermSet(entry);

    let score = 0;
    let matchedTokens = 0;
    for (const token of signalTokens) {
      if (tagTerms.has(token)) { score += 3; matchedTokens += 1; }
      else if (proseTerms.has(token)) { score += 1; matchedTokens += 1; }
    }
    if (score <= 0) continue;

    scored.push({
      score,
      matchedTokens,
      mechanism: {
        slug,
        summary: entry.summary ?? '',
        practicalImplication: entry.practicalImplication ?? '',
        citation: source.citation,
        doi: source.doi,
      },
    });
  }

  // Highest score first; deterministic alphabetical tiebreak by slug.
  scored.sort((a, b) => b.score - a.score || a.mechanism.slug.localeCompare(b.mechanism.slug));

  // Precision gate: only cite confidently-relevant mechanisms. If even the best
  // match is weak, cite nothing. Otherwise keep the top match plus any others
  // within SECONDARY_MARGIN of it — this drops tangential single-tag matches.
  const top = scored[0];
  if (!top || top.score < MIN_RELEVANCE_SCORE || top.matchedTokens < MIN_DISTINCT_TOKENS) return [];
  const floor = Math.max(MIN_RELEVANCE_SCORE, top.score * SECONDARY_MARGIN);
  return scored
    .filter((entry) => entry.score >= floor && entry.matchedTokens >= MIN_DISTINCT_TOKENS)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.mechanism);
}
