import { describe, expect, it } from 'vitest';
import {
  buildAccumulatedMemoryText,
  buildCorrectedMemoryText,
  inferSafetyConstraints,
  sanitizeGroundedSearchQuery,
} from '../src/lib/ask-memory-correction.js';

describe('ask memory correction helpers', () => {
  it('recognizes idiomatic shellfish reactions as safety constraints', () => {
    expect(inferSafetyConstraints('Shrimp and crab make me swell up.')).toEqual(expect.arrayContaining([
      'shellfish allergy',
    ]));
  });

  it('sanitizes grounded search queries without adding store-finding terms', () => {
    const sanitized = sanitizeGroundedSearchQuery('I remember chilhuacle chiles <script>alert(1)</script> near Des Moines!!! Give me the smallest first-pass memory cue.');

    expect(sanitized).toContain('chilhuacle chiles');
    expect(sanitized).toContain('Des Moines');
    expect(sanitized).not.toMatch(/[<>!]/);
    expect(sanitized.length).toBeLessThanOrEqual(180);
  });

  it('drops stale history when the latest correction resets the food family', () => {
    const corrected = buildCorrectedMemoryText(
      'The old memory was a cold rice-cinnamon drink.',
      'Correction: I remembered wrong. It was not a drink; it was a sour soup from my Polish neighbor.',
      [
        { role: 'user', content: 'My aunt made a cold rice-cinnamon drink.' },
        { role: 'assistant', content: 'I can build a tiny beverage cue.' },
      ],
    );

    expect(corrected).toMatch(/\bsour soup\b/i);
    expect(corrected).toMatch(/\bPolish neighbor\b/i);
    expect(corrected).not.toMatch(/\brice[-\s]?cinnamon\b/i);
    expect(corrected).not.toMatch(/\b(?:cold|drink|beverage)\b/i);
  });

  it('keeps latest positive anchors when the correction only changes descriptors', () => {
    const corrected = buildCorrectedMemoryText(
      'The old memory was a milky, creamy, sweet rice-cinnamon drink.',
      'Correction: I remembered wrong. The rice-cinnamon drink was not milky or creamy; it was watery, icy, barely sweet, and sharp with lime.',
      [
        { role: 'user', content: 'My aunt made a cold rice-cinnamon drink. It may have been milky and creamy.' },
        { role: 'assistant', content: 'I need one more detail about the drink.' },
      ],
    );

    expect(corrected).toMatch(/\brice[-\s]?cinnamon drink\b/i);
    expect(corrected).toMatch(/\b(?:watery|icy|barely sweet|lime)\b/i);
    expect(corrected).not.toMatch(/\b(?:milky|creamy|cream)\b/i);
  });
});

describe('buildAccumulatedMemoryText (cross-turn memory persistence)', () => {
  it('folds earlier-turn clues into a non-correction follow-up so nothing resets', () => {
    const accumulated = buildAccumulatedMemoryText(
      'oven baked. it was in puerto rico but i dont think the recipe is from there',
      [
        { role: 'user', content: 'A cake my mom made — moist, with grated coconut and a caramel top.' },
        { role: 'assistant', content: '(memory receipt)' },
      ],
    );

    // The earlier dessert + ingredient clues must survive into this turn's memory.
    expect(accumulated).toMatch(/\bcake\b/i);
    expect(accumulated).toMatch(/\bcoconut\b/i);
    expect(accumulated).toMatch(/\bcaramel\b/i);
    // The latest clue is still present.
    expect(accumulated).toMatch(/\boven baked\b/i);
  });

  it('returns the latest text unchanged when there is no prior user history (single turn)', () => {
    expect(buildAccumulatedMemoryText('a cold cinnamon drink', [])).toBe('a cold cinnamon drink');
    expect(buildAccumulatedMemoryText('a cold cinnamon drink')).toBe('a cold cinnamon drink');
  });

  it('does not duplicate the latest clue when the model echoes the prior user turn', () => {
    const accumulated = buildAccumulatedMemoryText('oven baked dessert', [
      { role: 'user', content: 'oven baked dessert' },
    ]);
    expect(accumulated).toBe('oven baked dessert');
  });

  it('keeps the latest clue even when older turns overflow the character cap', () => {
    const huge = 'x'.repeat(9000);
    const accumulated = buildAccumulatedMemoryText('the newest decisive clue', [
      { role: 'user', content: huge },
    ]);
    expect(accumulated).toContain('the newest decisive clue');
    expect(accumulated.length).toBeLessThanOrEqual(6000);
  });
});
