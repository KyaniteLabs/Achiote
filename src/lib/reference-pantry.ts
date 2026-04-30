import referencePantryFixturesData from '../data/reference-pantry-fixtures.json' with { type: 'json' };
import type { ResearchCache } from './research-cache.js';
import type { ResearchCacheEntry } from './types.js';

type ReferencePantryFixture = (typeof referencePantryFixturesData.fixtures)[number];

export type ReferenceResearchSource = 'cache' | 'bundled';

export interface ReferenceResearchMatch {
  source: ReferenceResearchSource;
  entry: ResearchCacheEntry;
}

function lookupKey(dishFamily: string, region: string): string {
  return `${dishFamily.trim().toLowerCase()}\u0000${region.trim().toLowerCase()}`;
}

function fixtureEntry(fixture: ReferencePantryFixture): ResearchCacheEntry {
  return {
    dishFamily: fixture.cacheTarget.dishFamily,
    region: fixture.cacheTarget.region,
    researchData: JSON.stringify(fixture.record),
    createdAt: fixture.record.createdAt,
    hitCount: 0,
  };
}

const bundledFixtureIndex = new Map<string, ReferencePantryFixture>();
const bundledFixtureFamilies = new Map<string, ReferencePantryFixture[]>();

for (const fixture of referencePantryFixturesData.fixtures) {
  bundledFixtureIndex.set(lookupKey(fixture.cacheTarget.dishFamily, fixture.cacheTarget.region), fixture);
  const familyKey = fixture.cacheTarget.dishFamily.trim().toLowerCase();
  const familyFixtures = bundledFixtureFamilies.get(familyKey) ?? [];
  familyFixtures.push(fixture);
  bundledFixtureFamilies.set(familyKey, familyFixtures);
}

export function getBundledReferenceResearch(dishFamily: string, region: string): ReferenceResearchMatch | null {
  const exactFixture = bundledFixtureIndex.get(lookupKey(dishFamily, region));
  if (exactFixture) return { source: 'bundled', entry: fixtureEntry(exactFixture) };

  const familyFixtures = bundledFixtureFamilies.get(dishFamily.trim().toLowerCase()) ?? [];
  const globalFixture = familyFixtures.find((fixture) => fixture.cacheTarget.region.toLowerCase() === 'global');
  if (globalFixture) return { source: 'bundled', entry: fixtureEntry(globalFixture) };

  return null;
}

export function getReferenceResearch(
  dishFamily: string,
  region: string,
  cache: ResearchCache | null,
): ReferenceResearchMatch | null {
  const cached = cache?.get(dishFamily, region);
  if (cached) return { source: 'cache', entry: cached };
  return getBundledReferenceResearch(dishFamily, region);
}
