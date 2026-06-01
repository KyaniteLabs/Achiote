import { describe, expect, it } from 'vitest';
import {
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
