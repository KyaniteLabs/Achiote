import { describe, expect, it } from 'vitest';
import { canonicalToolInput, filterRepeatedToolCalls } from '../src/lib/tool-loop.js';

describe('tool loop detection', () => {
  it('treats object inputs with different key order as the same call', () => {
    expect(canonicalToolInput({ ingredient: 'cashew', location: 'Madison' })).toBe(
      canonicalToolInput({ location: 'Madison', ingredient: 'cashew' }),
    );
  });

  it('allows repeated tool names when the inputs are materially different', () => {
    const decision = filterRepeatedToolCalls([
      { name: 'find_sensory_substitutes', input: { ingredient: 'cashew' } },
      { name: 'find_sensory_substitutes', input: { ingredient: 'butter' } },
      { name: 'find_sensory_substitutes', input: { ingredient: 'cream' } },
    ], []);

    expect(decision.allowedCalls.map((call) => call.input)).toEqual([
      { ingredient: 'cashew' },
      { ingredient: 'butter' },
      { ingredient: 'cream' },
    ]);
    expect(decision.blockedCalls).toEqual([]);
  });

  it('blocks true duplicate tool calls with the same canonical input', () => {
    const decision = filterRepeatedToolCalls([
      { name: 'find_sensory_substitutes', input: { ingredient: 'cashew', location: 'Madison' } },
    ], [
      { name: 'find_sensory_substitutes', input: { location: 'Madison', ingredient: 'cashew' } },
    ]);

    expect(decision.allowedCalls).toEqual([]);
    expect(decision.blockedCalls).toMatchObject([
      { call: { name: 'find_sensory_substitutes' }, previousCount: 1, reason: 'duplicate_input' },
    ]);
  });

  it('keeps an absolute cap per tool even when inputs differ', () => {
    const history = ['cashew', 'butter', 'cream', 'whiskey', 'yogurt'].map((ingredient) => ({
      name: 'find_sensory_substitutes',
      input: { ingredient },
    }));
    const decision = filterRepeatedToolCalls([
      { name: 'find_sensory_substitutes', input: { ingredient: 'ghee' } },
    ], history);

    expect(decision.allowedCalls).toEqual([]);
    expect(decision.blockedCalls).toMatchObject([
      { call: { name: 'find_sensory_substitutes' }, previousCount: 5, reason: 'max_calls' },
    ]);
  });
});
