import regionalData from '../data/regional-availability.json' with { type: 'json' };

export type MatchedRegion = {
  key: string;
  matchLevel?: 'metro' | 'worldwide_fallback';
  data: {
    cities: string[];
    majorEthnicCorridors: { name: string; city: string; cuisines: string[] }[];
    majorStores: Record<string, string[]>;
  };
};

export function findMatchingRegion(location: string): MatchedRegion | null {
  const normalized = location.toLowerCase().trim().replace(/-/g, ' ');
  if (normalized.length < 2) return null;

  for (const [key, data] of Object.entries(regionalData.regions)) {
    if (normalized.includes(key.replace(/-/g, ' ')) || key.replace(/-/g, ' ').includes(normalized)) {
      return { key, matchLevel: 'metro', data: { ...data, majorEthnicCorridors: prioritizeCorridors(data.majorEthnicCorridors, location) } };
    }

    for (const city of data.cities) {
      if (normalized.includes(city.toLowerCase()) || city.toLowerCase().includes(normalized)) {
        return { key, matchLevel: 'metro', data: { ...data, majorEthnicCorridors: prioritizeCorridors(data.majorEthnicCorridors, location) } };
      }
    }
  }

  const worldwide = regionalData.layers?.worldwide;
  if (!worldwide) return null;
  return {
    key: 'worldwide-fallback',
    matchLevel: 'worldwide_fallback',
    data: {
      cities: [location],
      majorEthnicCorridors: worldwide.majorEthnicCorridors,
      majorStores: worldwide.majorStores,
    },
  };
}

/**
 * Stable-sort corridors so entries whose city is named in the user's location come first —
 * a Portland query must lead with Portland corridors, not the region's default ordering.
 * Array.prototype.sort is stable, so non-matching corridors keep their dataset order.
 */
function prioritizeCorridors(
  corridors: { name: string; city: string; cuisines: string[] }[],
  location: string,
): { name: string; city: string; cuisines: string[] }[] {
  const normalized = location.toLowerCase();
  return [...corridors].sort((a, b) => cityHit(b, normalized) - cityHit(a, normalized));
}

function cityHit(corridor: { city: string }, normalizedLocation: string): number {
  return normalizedLocation.includes(corridor.city.toLowerCase()) ? 1 : 0;
}
