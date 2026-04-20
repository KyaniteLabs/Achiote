import { randomBytes, timingSafeEqual } from 'node:crypto';

export type Tier = 'free' | 'pro' | 'business' | 'enterprise';

export interface ApiKeyRecord {
  key: string;
  tier: Tier;
  name: string;
  createdAt: string;
}

export interface AuthResult {
  authenticated: true;
  tier: Tier;
  name: string;
}

export interface AuthFailure {
  authenticated: false;
  error: string;
}

export type AuthOutcome = AuthResult | AuthFailure;

const VALID_TIERS = new Set<string>(['free', 'pro', 'business', 'enterprise']);


const TIER_LIMITS: Record<Tier, { mcpCallsPerMonth: number; webReconstructions: number }> = {
  free: { mcpCallsPerMonth: 50, webReconstructions: 3 },
  pro: { mcpCallsPerMonth: 5_000, webReconstructions: Infinity },
  business: { mcpCallsPerMonth: 100_000, webReconstructions: Infinity },
  enterprise: { mcpCallsPerMonth: Infinity, webReconstructions: Infinity },
};

export function getTierLimits(tier: Tier) {
  return TIER_LIMITS[tier];
}

const KEY_PREFIX = 'ach_';

export function generateApiKey(tier: Tier, name: string): ApiKeyRecord {
  const secret = randomBytes(24).toString('hex');
  const key = `${KEY_PREFIX}${secret}`;
  return {
    key,
    tier,
    name,
    createdAt: new Date().toISOString(),
  };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function createAuthenticator(keys: ApiKeyRecord[]) {
  const seen = new Set<string>();
  for (const r of keys) {
    if (seen.has(r.key)) {
      console.warn(`Duplicate API key detected (name: "${r.name}"). Last entry wins.`);
    }
    seen.add(r.key);
  }
  const keyMap = new Map(keys.map((r) => [r.key, r]));

  return {
    authenticate(rawKey: string | undefined): AuthOutcome {
      if (!rawKey) {
        return { authenticated: false, error: 'API key required. Pass via x-api-key header or apiKey query param.' };
      }

      for (const record of keyMap.values()) {
        if (safeEqual(rawKey, record.key)) {
          return { authenticated: true, tier: record.tier, name: record.name };
        }
      }

      return { authenticated: false, error: 'Invalid API key.' };
    },

    addKey(record: ApiKeyRecord) {
      keyMap.set(record.key, record);
    },

    removeKey(key: string) {
      keyMap.delete(key);
    },

    listKeys(): Omit<ApiKeyRecord, 'key'>[] {
      return [...keyMap.values()].map(({ key: _key, ...rest }) => rest);
    },
  };
}

export function loadKeysFromEnv(envValue: string | undefined): ApiKeyRecord[] {
  if (!envValue) return [];

  try {
    const parsed = JSON.parse(envValue);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r: unknown) =>
        typeof r === 'object' && r !== null &&
        typeof (r as Record<string, unknown>).key === 'string' &&
        typeof (r as Record<string, unknown>).tier === 'string' &&
        VALID_TIERS.has((r as Record<string, unknown>).tier as string) &&
        typeof (r as Record<string, unknown>).name === 'string',
    ) as ApiKeyRecord[];
  } catch (err) {
    console.warn('ACHIOTE_API_KEYS: failed to parse JSON —', err instanceof Error ? err.message : String(err));
    return [];
  }
}
