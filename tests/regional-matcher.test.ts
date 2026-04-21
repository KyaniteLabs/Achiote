import { describe, it, expect } from 'vitest';
import { findMatchingRegion } from '../src/lib/regional-matcher.js';

describe('findMatchingRegion', () => {
  it('returns null for empty or too-short input', () => {
    expect(findMatchingRegion('')).toBeNull();
    expect(findMatchingRegion('a')).toBeNull();
  });

  it('matches a known region key (spaces in input)', () => {
    const result = findMatchingRegion('southern california');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('southern-california');
  });

  it('matches region key with spaces (hyphens replaced)', () => {
    const result = findMatchingRegion('southern california');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('southern-california');
  });

  it('matches by city name', () => {
    const result = findMatchingRegion('atlanta');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('atlanta-metro');
  });

  it('returns null for unknown location', () => {
    expect(findMatchingRegion('antarctica-research-station')).toBeNull();
  });

  it('matches hyphenated input (southern-california)', () => {
    const result = findMatchingRegion('southern-california');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('southern-california');
  });

  it('matches hyphenated input (bay-area)', () => {
    const result = findMatchingRegion('bay-area');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('bay-area');
  });

  it('matches mixed-case hyphenated input', () => {
    const result = findMatchingRegion('New-York-Metro');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('new-york-metro');
  });

  it('returns data with expected structure', () => {
    const result = findMatchingRegion('atlanta-metro');
    expect(result).not.toBeNull();
    expect(result!.data).toHaveProperty('cities');
    expect(result!.data).toHaveProperty('majorEthnicCorridors');
    expect(result!.data).toHaveProperty('majorStores');
  });
});
