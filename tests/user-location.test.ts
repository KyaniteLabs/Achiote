import { describe, expect, it } from 'vitest';
import { inferUserLocationFromMessage } from '../src/lib/user-location.js';

describe('user location inference', () => {
  it('does not treat near me phrasing as a sourcing location', () => {
    expect(inferUserLocationFromMessage('Where can I buy dried chiltepin near me for this memory?')).toBeUndefined();
    expect(inferUserLocationFromMessage('Where can I buy hoja santa near my area?')).toBeUndefined();
  });

  it('keeps concrete purchase and residence locations', () => {
    expect(inferUserLocationFromMessage('Where can I buy hoja santa near Minneapolis for a tiny memory test?')).toBe('Minneapolis');
    expect(inferUserLocationFromMessage('I live in Queens, New York and want chilhuacle chiles.')).toBe('Queens');
  });
});
