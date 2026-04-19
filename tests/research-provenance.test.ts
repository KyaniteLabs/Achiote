import { describe, expect, it } from 'vitest';
import {
  buildResearchRecord,
  extractResearchFindings,
  validateResearchRecord,
} from '../src/lib/research-provenance.js';

describe('research provenance records', () => {
  it('extracts cited findings into a trustable research record', () => {
    const record = buildResearchRecord({
      dishName: 'pasteles',
      query: 'Puerto Rican pasteles holiday banana leaves masa pork',
      sources: [
        {
          title: 'Puerto Rican Pasteles Guide',
          url: 'https://example.org/pasteles',
          sourceType: 'recipe',
          accessedAt: '2026-04-18T00:00:00.000Z',
          reliability: 'Medium',
          extractedFacts: [
            'Pasteles are often wrapped in banana leaves.',
            'Pasteles may use green banana or root-vegetable masa.',
            'Pork or sofrito-seasoned filling is common in many family versions.',
          ],
        },
      ],
    });

    expect(record.confidence).toBe('Medium');
    expect(record.extractedFacts.ingredients).toEqual(expect.arrayContaining(['banana leaves', 'green banana', 'pork', 'sofrito']));
    expect(record.extractedFacts.techniques).toContain('wrapped or steamed preparation');
    expect(record.sources[0].quotedFacts).toHaveLength(3);
    expect(validateResearchRecord(record)).toEqual([]);
  });

  it('rejects records with unsupported claims or missing source metadata', () => {
    const record = buildResearchRecord({
      dishName: 'unknown',
      query: 'unknown family food',
      sources: [
        {
          title: '',
          url: 'not-a-url',
          sourceType: 'recipe',
          accessedAt: '',
          reliability: 'High',
          extractedFacts: [],
        },
      ],
    });

    const issues = validateResearchRecord(record);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'sources[0].title' }),
      expect.objectContaining({ path: 'sources[0].url' }),
      expect.objectContaining({ path: 'sources[0].accessedAt' }),
      expect.objectContaining({ path: 'sources[0].quotedFacts' }),
    ]));
  });

  it('summarizes researched and unknown fields for the dossier handoff', () => {
    const record = buildResearchRecord({
      dishName: 'egusi soup',
      query: 'egusi soup melon seeds greens regional variations',
      sources: [
        {
          title: 'Egusi Soup Overview',
          url: 'https://example.org/egusi',
          sourceType: 'article',
          accessedAt: '2026-04-18T00:00:00.000Z',
          reliability: 'Medium',
          extractedFacts: ['Egusi soup is associated with melon seeds and leafy greens in many West African versions.'],
        },
      ],
    });

    const findings = extractResearchFindings(record);

    expect(findings.researchedFacts.join(' ')).toContain('melon seeds');
    expect(findings.unknowns).toContain('family-specific version');
    expect(findings.sourceCount).toBe(1);
  });
});
