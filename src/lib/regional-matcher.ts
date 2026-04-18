import regionalData from '../data/regional-availability.json' with { type: 'json' };

export type MatchedRegion = {
  key: string;
  data: {
    cities: string[];
    majorEthnicCorridors: { name: string; city: string; cuisines: string[] }[];
    majorStores: Record<string, string[]>;
  };
};

export function findMatchingRegion(location: string): MatchedRegion | null {
  const normalized = location.toLowerCase().trim();

  for (const [key, data] of Object.entries(regionalData.regions)) {
    if (normalized.includes(key.replace(/-/g, ' ')) || key.replace(/-/g, ' ').includes(normalized)) {
      return { key, data };
    }

    for (const city of data.cities) {
      if (normalized.includes(city.toLowerCase()) || city.toLowerCase().includes(normalized)) {
        return { key, data };
      }
    }
  }

  return null;
}
