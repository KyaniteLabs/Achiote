import { describe, expect, it } from 'vitest';
import {
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
