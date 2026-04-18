import { describe, it, expect } from 'vitest';
import { resolveDishName } from '../src/lib/name-resolver.js';

describe('resolveDishName', () => {
  it('resolves exact alias match', () => {
    const result = resolveDishName('dolma');
    expect(result.canonicalName).toBe('stuffed-vegetables');
    expect(result.confidence).toBe('High');
  });

  it('resolves transliteration variants', () => {
    const result = resolveDishName('biryani');
    expect(result.canonicalName).toBe('rice-dish');
    expect(result.aliases).toContain('biryani');
  });

  it('handles fuzzy input with approximate spelling', () => {
    const result = resolveDishName('perogi');
    expect(result.canonicalName).toBe('dumpling');
    expect(result.confidence).toBe('Medium');
  });

  it('returns unmatched result for unknown dishes', () => {
    const result = resolveDishName('some-completely-unknown-dish-xyz');
    expect(result.confidence).toBe('Low');
    expect(result.canonicalName).toBe('some-completely-unknown-dish-xyz');
  });

  it('finds family match for empanada', () => {
    const result = resolveDishName('empanada');
    expect(result.canonicalName).toBe('dumpling');
    expect(result.aliases).toContain('empanada');
  });

  it('resolves canonical name directly', () => {
    const result = resolveDishName('flatbread');
    expect(result.canonicalName).toBe('flatbread');
    expect(result.confidence).toBe('High');
  });

  it('handles spaces and hyphens in input', () => {
    const result = resolveDishName('cabbage roll');
    expect(result.canonicalName).toBe('stuffed-vegetables');
  });
});
