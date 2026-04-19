import type { Confidence } from './types.js';

import type { ResearchFindingsForDossier, ResearchRecord, ResearchRecordInput, ResearchValidationIssue } from './types.js';

const INGREDIENT_PATTERNS: Array<[string, RegExp]> = [
  ['banana leaves', /banana leaves?/i],
  ['green banana', /green banana|green-bananas|banana masa|plantain masa/i],
  ['root-vegetable masa', /yaut[ií]a|root-vegetable/i],
  ['pork', /pork/i],
  ['sofrito', /sofrito/i],
  ['plantains', /plantain/i],
  ['melon seeds', /melon seeds?|egusi/i],
  ['leafy greens', /leafy greens?|bitter greens?|greens/i],
  ['lamb', /lamb/i],
  ['dill', /dill/i],
];

const TECHNIQUE_PATTERNS: Array<[string, RegExp]> = [
  ['wrapped or steamed preparation', /wrapped|steamed|banana leaves/i],
  ['layered casserole', /layered|casserole|baked/i],
  ['fried preparation', /fried|fry/i],
  ['soup or stew preparation', /soup|stew|broth/i],
];

const SENSORY_PATTERNS: Array<[string, RegExp]> = [
  ['leaf aroma', /banana leaves?|leaf aroma/i],
  ['soft masa texture', /masa|soft/i],
  ['savory seasoned filling', /sofrito|pork|savory/i],
  ['sweet plantain flavor', /sweet plantain|ripe plantain/i],
  ['sour/tangy profile', /sour|tangy|yogurt|fermented|vinegar|citrus/i],
];

const OCCASION_PATTERNS: Array<[string, RegExp]> = [
  ['holiday/family gatherings', /holiday|christmas|family gathering/i],
  ['street market food', /street market|market/i],
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function collectMatches(facts: string[], patterns: Array<[string, RegExp]>): string[] {
  return unique(patterns.filter(([, pattern]) => facts.some((fact) => pattern.test(fact))).map(([value]) => value));
}

function confidenceFromSources(sources: ResearchRecordInput['sources']): Confidence {
  if (sources.length >= 2 && sources.every((source) => source.reliability !== 'Low')) return 'High';
  if (sources.length >= 1 && sources.some((source) => source.reliability !== 'Low')) return 'Medium';
  return 'Low';
}

export function buildResearchRecord(input: ResearchRecordInput): ResearchRecord {
  const allFacts = input.sources.flatMap((source) => source.extractedFacts);
  const lowerDish = input.dishName.toLowerCase();

  return {
    dishName: input.dishName,
    query: input.query,
    sources: input.sources.map((source) => ({
      title: source.title,
      url: source.url,
      sourceType: source.sourceType,
      accessedAt: source.accessedAt,
      reliability: source.reliability,
      author: source.author,
      quotedFacts: source.extractedFacts,
    })),
    extractedFacts: {
      namesAndAliases: unique([input.dishName, ...allFacts.filter((fact) => fact.toLowerCase().includes(lowerDish))]),
      regions: unique(allFacts.filter((fact) => /Puerto Rican|Caribbean|Nigerian|West African|Nepal|Spanish|Brazilian/i.test(fact))),
      ingredients: collectMatches(allFacts, INGREDIENT_PATTERNS),
      techniques: collectMatches(allFacts, TECHNIQUE_PATTERNS),
      sensoryDescriptors: collectMatches(allFacts, SENSORY_PATTERNS),
      culturalOccasions: collectMatches(allFacts, OCCASION_PATTERNS),
      regionalVariants: unique(allFacts.filter((fact) => /variant|version|regional/i.test(fact))),
    },
    uncertainty: ['family-specific version', 'exact proportions', 'which sensory elements matter most to this user'],
    confidence: confidenceFromSources(input.sources),
    createdAt: new Date().toISOString(),
  };
}

function pushIssue(issues: ResearchValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateResearchRecord(record: ResearchRecord): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  if (!isNonEmptyString(record.dishName)) pushIssue(issues, 'dishName', 'must be a non-empty string');
  if (!isNonEmptyString(record.query)) pushIssue(issues, 'query', 'must be a non-empty string');
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    pushIssue(issues, 'sources', 'must include at least one source');
    return issues;
  }

  record.sources.forEach((source, index) => {
    const path = `sources[${index}]`;
    if (!isNonEmptyString(source.title)) pushIssue(issues, `${path}.title`, 'must be a non-empty string');
    if (!isNonEmptyString(source.url) || !isUrl(source.url)) pushIssue(issues, `${path}.url`, 'must be an http(s) URL');
    if (!isNonEmptyString(source.accessedAt)) pushIssue(issues, `${path}.accessedAt`, 'must be a non-empty timestamp');
    if (!Array.isArray(source.quotedFacts) || source.quotedFacts.length === 0) {
      pushIssue(issues, `${path}.quotedFacts`, 'must include extracted facts from the source');
    }
  });

  return issues;
}

export function extractResearchFindings(record: ResearchRecord): ResearchFindingsForDossier {
  return {
    researchedFacts: record.sources.flatMap((source) => source.quotedFacts),
    inferredFacts: [
      ...record.extractedFacts.ingredients.map((ingredient) => `Ingredient signal: ${ingredient}`),
      ...record.extractedFacts.techniques.map((technique) => `Technique signal: ${technique}`),
      ...record.extractedFacts.sensoryDescriptors.map((descriptor) => `Sensory signal: ${descriptor}`),
    ],
    unknowns: record.uncertainty,
    sourceCount: record.sources.length,
    confidence: record.confidence,
  };
}
