import { describe, it, expect } from 'vitest';
import { findSubstitutes } from '../src/lib/substitution-engine.js';

describe('findSubstitutes', () => {
  it('finds substitute by matching substitution group', () => {
    const results = findSubstitutes('cumin-seeds');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].original).toBe('Cumin Seeds');
    expect(results[0].confidence).toBeDefined();
  });

  it('returns empty array for unknown ingredients', () => {
    const results = findSubstitutes('unobtanium-powder');
    expect(results).toEqual([]);
  });

  it('finds substitutes by overlapping compounds (umami-ferment group)', () => {
    const results = findSubstitutes('fish-sauce');
    expect(results.some(r => r.substitute.toLowerCase().includes('soy'))).toBe(true);
  });

  it('ranks by compound match score descending', () => {
    const results = findSubstitutes('cumin-seeds');
    if (results.length > 1) {
      expect(results[0].compoundMatch).toBeGreaterThanOrEqual(results[1].compoundMatch);
    }
  });

  it('includes reasoning for each substitution', () => {
    const results = findSubstitutes('tamarind');
    if (results.length > 0) {
      expect(results[0].reasoning.length).toBeGreaterThan(10);
    }
  });
});
