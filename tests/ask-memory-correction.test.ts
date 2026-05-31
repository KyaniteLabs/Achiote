import { describe, expect, it } from 'vitest';
import {
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
});
