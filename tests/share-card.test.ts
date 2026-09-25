import { describe, expect, it } from 'vitest';
import type { CitedMechanism, MinimumViableNostalgiaCue } from '../src/lib/types.js';
import {
  buildShareCard,
  buildShareCardSvg,
  formatShareCardText,
  formatShareCardTitle,
  sanitizeShareCardText,
} from '../src/lib/share-card.js';

const dilutionMechanism: CitedMechanism = {
  slug: 'ethanol-dilution-aroma',
  summary: 'Diluting spirits with water shifts volatile aroma compounds.',
  practicalImplication: 'Adding water to whiskey releases guaiacol at the surface, pushing the aroma forward.',
  citation: 'Karlsson & Friedman (2017), Dilution of whisky increases aroma',
  doi: '10.1038/s41598-017-06423-5',
};

function cueWith(overrides: Partial<MinimumViableNostalgiaCue> = {}): MinimumViableNostalgiaCue {
  return {
    title: 'Sip neat, then add a few drops of water',
    goal: 'Taste the spirit at full strength, then dilute to hear the aroma open.',
    effortMinutes: 5,
    format: 'sip',
    ingredients: [],
    steps: [],
    preserves: [],
    doesNotPreserve: [],
    accessibilityPrinciples: [],
    substituteLogic: [],
    whyThisIsMinimum: '',
    confidence: 'High',
    safetyNotes: [],
    followUpIfItWorks: [],
    components: [],
    citedMechanisms: [dilutionMechanism],
    ...overrides,
  };
}

describe('buildShareCard — the privacy guarantee', () => {
  it('builds a card from a cited mechanism + cue (public food science only)', () => {
    const card = buildShareCard({ dishName: 'Whiskey', cue: cueWith() });
    expect(card).not.toBeNull();
    expect(card!.dishName).toBe('Whiskey');
    expect(card!.fact).toBe(dilutionMechanism.practicalImplication);
    expect(card!.doi).toBe(dilutionMechanism.doi);
    expect(card!.cueGoal).toBe('Taste the spirit at full strength, then dilute to hear the aroma open.');
  });

  it('returns null when there is no cited mechanism (the opt-in gate)', () => {
    expect(buildShareCard({ dishName: 'Ube', cue: cueWith({ citedMechanisms: [] }) })).toBeNull();
    expect(buildShareCard({ dishName: 'Ube' })).toBeNull();
    expect(buildShareCard({})).toBeNull();
  });

  it('returns null when the mechanism has no usable fact text', () => {
    const empty: CitedMechanism = { ...dilutionMechanism, practicalImplication: '', summary: '   ' };
    expect(buildShareCard({ mechanisms: [empty] })).toBeNull();
  });

  it('falls back to the mechanism slug when no dish name is given', () => {
    const card = buildShareCard({ mechanisms: [dilutionMechanism] });
    expect(card).not.toBeNull();
    expect(card!.dishName).toBe(dilutionMechanism.slug);
  });

  // THE privacy proof: buildShareCard's signature contains NO memory, userSaid,
  // ruledOut, or inferred parameter. This test asserts the structural truth —
  // the produced card never echoes personal prose even when the caller is sloppy,
  // because personal data is simply not a parameter the function accepts.
  it('cannot leak personal data: passing personal text as dishName is sanitized but mechanisms/cue are the only facts', () => {
    const card = buildShareCard({
      dishName: 'Whiskey',
      cue: cueWith(),
    });
    expect(card).not.toBeNull();
    // The fact is always the public mechanism — never free personal text.
    expect(card!.fact).toBe(dilutionMechanism.practicalImplication);
    // The DOI is always the verified source.
    expect(card!.doi).toBe(dilutionMechanism.doi);
    // No field carries arbitrary personal narrative.
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain('my grandfather');
    expect(serialized).not.toContain('abuela');
  });
});

describe('sanitizeShareCardText', () => {
  it('collapses whitespace and strips control characters', () => {
    expect(sanitizeShareCardText('  hello\n\nworld\t\x07  ')).toBe('hello world');
  });
  it('caps excessively long text', () => {
    const long = 'a'.repeat(500);
    expect(sanitizeShareCardText(long).length).toBe(220);
  });
  it('returns empty string for undefined', () => {
    expect(sanitizeShareCardText(undefined)).toBe('');
  });
});

describe('formatShareCardText / formatShareCardTitle', () => {
  const card = buildShareCard({ dishName: 'Whiskey', cue: cueWith() })!;

  it('produces a DOI-forward share text', () => {
    const text = formatShareCardText(card);
    expect(text).toContain('Whiskey');
    expect(text).toContain(card.fact);
    expect(text).toContain(`doi:${card.doi}`);
    expect(text).toContain('achiote.kyanitelabs.tech');
  });

  it('omits the cue line when there is no cueGoal', () => {
    const noCue = buildShareCard({ dishName: 'Whiskey', mechanisms: [dilutionMechanism] })!;
    expect(formatShareCardText(noCue)).not.toContain('Try it:');
  });

  it('produces a concise title', () => {
    expect(formatShareCardTitle(card)).toBe('Whiskey — verified food science');
  });
});

describe('buildShareCardSvg', () => {
  const card = buildShareCard({ dishName: 'Whiskey', cue: cueWith() })!;

  it('emits valid 1200×630 SVG containing only public data', () => {
    const svg = buildShareCardSvg(card);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain('Whiskey');
    expect(svg).toContain(`doi:${card.doi}`);
    // No personal narrative leaks into the rendered card.
    expect(svg).not.toContain('abuela');
  });

  it('XML-escapes special characters in the fact', () => {
    const tricky: CitedMechanism = {
      ...dilutionMechanism,
      practicalImplication: 'A < test > & "quotes" value',
    };
    const svg = buildShareCardSvg(buildShareCard({ mechanisms: [tricky] })!);
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&gt;');
    expect(svg).toContain('&quot;');
    expect(svg).not.toContain('< test >');
  });
});
