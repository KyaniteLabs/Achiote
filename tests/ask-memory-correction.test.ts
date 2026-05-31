import { describe, expect, it } from 'vitest';
import {
  buildLocalSourcingSearchQuery,
  isExplicitLocalSourcingSearchRequest,
} from '../src/lib/ask-memory-correction.js';

describe('ask memory correction helpers', () => {
  it('gates live local sourcing search to explicit store-finding requests', () => {
    expect(isExplicitLocalSourcingSearchRequest('Where can I buy chilhuacle chiles near Des Moines?')).toBe(true);
    expect(isExplicitLocalSourcingSearchRequest('I live in Des Moines and remember chilhuacle chiles.')).toBe(false);
  });

  it('does not force Oaxacan store terms onto generic chile searches', () => {
    const generic = buildLocalSourcingSearchQuery(['Thai bird chiles'], 'Des Moines, Iowa');
    const oaxacan = buildLocalSourcingSearchQuery(['chilhuacle chiles'], 'Des Moines, Iowa');

    expect(generic).toContain('spice shop international grocery specialty market');
    expect(generic).not.toMatch(/Oaxacan/i);
    expect(oaxacan).toContain('Mexican Oaxacan grocery dried chiles spice shop');
  });
});
