import { describe, expect, it } from 'vitest';
import {
  buildMemoryRelevanceContext,
  classifyFlavorPolarity,
  contradictsMemoryRelevance,
  filterMemoryResearchFacts,
  filterMemoryResearchSearchResults,
  isUsableMemoryResearchResult,
} from '../src/lib/research-evidence-filter.js';

describe('research evidence filter', () => {
  it('keeps shopping and supplement snippets out of memory research evidence', () => {
    const results = filterMemoryResearchSearchResults([
      {
        title: 'Goya Maduros Sweet Plantain Delivery or Pickup Near Me | Instacart',
        link: 'https://www.instacart.com/store/s?k=goya%20maduros%20sweet%20plantain',
        snippet: 'Get Goya Maduros Sweet Plantain products you love delivered to you in as fast as 1 hour via Instacart.',
      },
      {
        title: 'Herb Pharm Certified Organic Plantain Liquid Extract',
        link: 'https://example.com/plantain-extract',
        snippet: 'Plantain liquid extract for cleansing and detoxification.',
      },
      {
        title: 'Tipico Panameno: Sweet Plantain Delight',
        link: 'https://example.com/panama-plantains',
        snippet: 'This dish, a staple in Panamanian cuisine, is prepared by cooking plantains with sweet syrup.',
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].title).toMatch(/Panameno/i);
  });

  it('filters low-quality fact strings before they reach receipts', () => {
    expect(filterMemoryResearchFacts([
      'Get Goya Maduros Sweet Plantain products delivered in as fast as 1 hour via Instacart.',
      'Panamanian cuisine includes plantain dishes prepared with sweet syrup.',
    ])).toEqual([
      'Panamanian cuisine includes plantain dishes prepared with sweet syrup.',
    ]);
  });

  it('requires a cooking or culture signal for usable food-memory search results', () => {
    expect(isUsableMemoryResearchResult({
      title: 'Plantain product listing',
      link: 'https://example.com/product',
      snippet: 'Sweet plantain available online.',
    })).toBe(false);
    expect(isUsableMemoryResearchResult({
      title: 'Traditional plantain dish',
      link: 'https://example.com/recipe',
      snippet: 'A traditional recipe simmers plantains in syrup.',
    })).toBe(true);
  });
});

describe('flavor-polarity relevance gate', () => {
  it('classifies unambiguous polarity and stays null when mixed or unknown', () => {
    expect(classifyFlavorPolarity('a moist coconut cake with a caramel top')).toBe('sweet');
    expect(classifyFlavorPolarity('oven-baked ground beef with gravy')).toBe('savory');
    expect(classifyFlavorPolarity('a beef stew finished with a caramel glaze')).toBeNull(); // both → keep
    expect(classifyFlavorPolarity('plantains cooked over a fire')).toBeNull();
  });

  it('derives sweet polarity from a remembered dessert', () => {
    const ctx = buildMemoryRelevanceContext({
      rawMemory: 'a cake my mom made',
      extractedClues: {
        possibleDishNames: ['cake'],
        rememberedIngredients: ['coconut', 'caramel'],
        sensoryClues: ['moist', 'caramel top'],
      },
    });
    expect(ctx.polarity).toBe('sweet');
  });

  it('drops a savory result for a remembered dessert but keeps the matching dessert result', () => {
    const dessert = buildMemoryRelevanceContext({
      extractedClues: { possibleDishNames: ['cake'], rememberedIngredients: ['coconut', 'caramel'], sensoryClues: ['caramel top'] },
    });
    const results = filterMemoryResearchSearchResults(
      [
        { title: 'Coconut Cake with Dulce de Leche', link: 'https://example.com/cake', snippet: 'This coconut cake recipe with dulce de leche is a beloved family dessert.' },
        { title: 'Best oven-baked ground beef', link: 'https://example.com/beef', snippet: 'The best oven-baked ground beef recipe everyone asks for.' },
      ],
      dessert,
    );
    expect(results).toHaveLength(1);
    expect(results[0].title).toMatch(/coconut cake/i);
  });

  it('is conservative: no context or mixed/uncertain results are never dropped', () => {
    // Same savory result, but no memory context → kept (backward compatible).
    expect(filterMemoryResearchSearchResults([
      { title: 'Best oven-baked ground beef', snippet: 'A traditional oven-baked ground beef recipe.' },
    ])).toHaveLength(1);
    // Savory memory keeps savory facts; only opposite polarity is dropped.
    const savory = buildMemoryRelevanceContext({ extractedClues: { rememberedIngredients: ['beef', 'broth'], possibleDishNames: ['stew'], sensoryClues: [] } });
    expect(contradictsMemoryRelevance('A hearty traditional beef stew recipe.', savory)).toBe(false);
    expect(contradictsMemoryRelevance('A sweet chocolate cake dessert recipe.', savory)).toBe(true);
  });

  it('filterMemoryResearchFacts also drops flavor-contradicting fact strings', () => {
    const dessert = buildMemoryRelevanceContext({ extractedClues: { possibleDishNames: ['cake'], rememberedIngredients: ['caramel'], sensoryClues: [] } });
    expect(filterMemoryResearchFacts([
      'Coconut cake with dulce de leche is a classic dessert recipe.',
      'The best oven-baked ground beef recipe everyone asks for.',
    ], dessert)).toEqual([
      'Coconut cake with dulce de leche is a classic dessert recipe.',
    ]);
  });
});
