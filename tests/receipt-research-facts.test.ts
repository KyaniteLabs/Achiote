import { describe, expect, it } from 'vitest';
import { deriveResearchedFactsForReceipt } from '../src/core/ask-engine.js';

// Regression coverage for the receipt "Dish resolved" confidence line.
//
// Defect 3b (BACKEND-FIX-REPORT.md) intended: when resolve_dish_name returns a real match with Low
// confidence BUT search_web produced results, the receipt should report the dish as Medium (research
// backed the identity up). The original fix put that Low->Medium promotion *inside* a guard that
// already excluded Low (`hasResolvedDishEvidence` requires `confidence !== 'Low'`), so the promotion
// was unreachable dead code and never fired. These tests pin the corrected behavior.

const memory = {
  rawMemory: 'my grandmother in Oaxaca made mole negro with chilhuacle chiles',
  extractedClues: {
    possibleDishNames: ['mole negro'],
    culturalOrRegionalHints: ['Oaxaca'],
    rememberedIngredients: ['chilhuacle chiles'],
    sensoryClues: ['dark', 'bitter-sweet'],
    occasions: [],
  },
};

const searchHit = {
  results: [{ title: 'Mole Negro', snippet: 'Oaxacan mole negro relies on chilhuacle negro chiles.' }],
};

const dishLine = (facts: string[]): string | undefined =>
  facts.find((fact) => /^Dish resolved: "Mole Negro"/.test(fact));

describe('deriveResearchedFactsForReceipt — dish-resolution confidence line', () => {
  it('promotes a Low-confidence match to Medium when search_web produced results', () => {
    const facts = deriveResearchedFactsForReceipt({
      collect_food_memory: memory,
      resolve_dish_name: { canonicalName: 'Mole Negro', region: 'Oaxaca', confidence: 'Low', matchType: 'alias' },
      search_web: searchHit,
    });
    const line = dishLine(facts);
    expect(line, 'expected a "Dish resolved" line').toBeDefined();
    // The exact regression: this was "Low" (then suppressed) before the fix.
    expect(line).toContain('confidence: Medium');
    expect(line).not.toContain('confidence: Low');
  });

  it('leaves a Low-confidence match unsurfaced when there is no research to back it up', () => {
    const facts = deriveResearchedFactsForReceipt({
      collect_food_memory: memory,
      resolve_dish_name: { canonicalName: 'Mole Negro', region: 'Oaxaca', confidence: 'Low', matchType: 'alias' },
      // no search_web
    });
    expect(dishLine(facts)).toBeUndefined();
  });

  it('does not surface an unknown-matchType resolution even with research (the mole-negro live case)', () => {
    const facts = deriveResearchedFactsForReceipt({
      collect_food_memory: memory,
      resolve_dish_name: { canonicalName: 'mole', region: 'Oaxacan', confidence: 'Low', matchType: 'unknown' },
      search_web: searchHit,
    });
    expect(facts.some((fact) => /^Dish resolved:/.test(fact))).toBe(false);
  });

  it('reports a genuine Medium match as Medium (unchanged behavior)', () => {
    const facts = deriveResearchedFactsForReceipt({
      collect_food_memory: memory,
      resolve_dish_name: { canonicalName: 'Mole Negro', region: 'Oaxaca', confidence: 'Medium', matchType: 'alias' },
      search_web: searchHit,
    });
    expect(dishLine(facts)).toContain('confidence: Medium');
  });
});
