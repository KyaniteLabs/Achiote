import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type Tier = 'free' | 'personal' | 'pro' | 'family' | 'business' | 'enterprise';

export interface ApiKeyRecord {
  key?: string;
  keyId?: string;
  keyHash?: string;
  tier: Tier;
  name: string;
  createdAt: string;
}

export interface ApiKeyGenerationRecord extends ApiKeyRecord {
  key: string;
  keyId: string;
  keyHash: string;
}

export interface ApiKeyStoredRecord {
  keyId: string;
  keyHash: string;
  tier: Tier;
  name: string;
  createdAt: string;
}

export interface AuthResult {
  authenticated: true;
  tier: Tier;
  name: string;
  keyId: string;
}

export interface AuthFailure {
  authenticated: false;
  error: string;
}

export type AuthOutcome = AuthResult | AuthFailure;

const VALID_TIERS = new Set<string>(['free', 'personal', 'pro', 'family', 'business', 'enterprise']);

const TIER_LIMITS: Record<Tier, { mcpCallsPerMonth: number; webReconstructions: number }> = {
  free: { mcpCallsPerMonth: 0, webReconstructions: 100 },
  personal: { mcpCallsPerMonth: 0, webReconstructions: 25 },
  pro: { mcpCallsPerMonth: 250, webReconstructions: 100 },
  family: { mcpCallsPerMonth: 250, webReconstructions: 300 },
  // Legacy alias for pre-family billing/API records. Keep this out of new public checkout.
  business: { mcpCallsPerMonth: 250, webReconstructions: 300 },
  enterprise: { mcpCallsPerMonth: Infinity, webReconstructions: Infinity },
};

export function getTierLimits(tier: Tier) {
  return TIER_LIMITS[tier];
}

const KEY_PREFIX = 'ach_';
const KEY_ID_PREFIX = 'ak_';
const HASH_PREFIX = 'sha256:';
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const KEY_ID_RE = /^(ak|legacy)_[0-9a-f]{16}$/;

export function hashApiKey(rawKey: string): string {
  return `${HASH_PREFIX}${createHash('sha256').update(rawKey).digest('hex')}`;
}

export function generateApiKey(tier: Tier, name: string): ApiKeyGenerationRecord {
  const secret = randomBytes(24).toString('hex');
  const key = `${KEY_PREFIX}${secret}`;
  return {
    key,
    keyId: `${KEY_ID_PREFIX}${randomBytes(8).toString('hex')}`,
    keyHash: hashApiKey(key),
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

function stableLegacyKeyId(rawKey: string): string {
  return `legacy_${createHash('sha256').update(rawKey).digest('hex').slice(0, 16)}`;
}

function normalizedRecord(record: ApiKeyRecord): ApiKeyStoredRecord | null {
  if (record.keyHash) {
    return {
      keyId: record.keyId ?? stableLegacyKeyId(record.keyHash),
      keyHash: record.keyHash,
      tier: record.tier,
      name: record.name,
      createdAt: record.createdAt,
    };
  }

  if (record.key) {
    console.warn(`Plaintext API key record detected (name: "${record.name}"). Use keyHash instead.`);
    return {
      keyId: record.keyId ?? stableLegacyKeyId(record.key),
      keyHash: hashApiKey(record.key),
      tier: record.tier,
      name: record.name,
      createdAt: record.createdAt,
    };
  }

  return null;
}

// Built-in dev/test key — always available, only valid when no ACHIOTE_API_KEYS are configured.
// Key: ach_dev_test_only
const DEV_KEY = 'ach_dev_test_only';
const DEV_KEY_HASH = hashApiKey(DEV_KEY);
const DEV_KEY_RECORD: ApiKeyStoredRecord = {
  keyId: 'ak_dev',
  keyHash: DEV_KEY_HASH,
  tier: 'pro',
  name: 'dev-test',
  createdAt: new Date(0).toISOString(),
};

export function createAuthenticator(keys: ApiKeyRecord[], includeDevKey = true) {
  const keyMap = new Map<string, ApiKeyStoredRecord>();

  // Inject the built-in dev key when no real keys are configured
  if (includeDevKey && keys.length === 0) {
    keyMap.set(DEV_KEY_RECORD.keyId, DEV_KEY_RECORD);
  }

  for (const record of keys) {
    const normalized = normalizedRecord(record);
    if (!normalized) continue;
    for (const [existingKeyId, existing] of keyMap.entries()) {
      if (safeEqual(existing.keyHash, normalized.keyHash) && existingKeyId !== normalized.keyId) {
        console.warn(`Duplicate API key hash detected (name: "${normalized.name}"). Last entry wins.`);
        keyMap.delete(existingKeyId);
      }
    }
    if (keyMap.has(normalized.keyId)) {
      console.warn(`Duplicate API key detected (name: "${normalized.name}"). Last entry wins.`);
    }
    keyMap.set(normalized.keyId, normalized);
  }

  return {
    authenticate(rawKey: string | undefined): AuthOutcome {
      if (!rawKey) {
        return { authenticated: false, error: 'API key required. Pass via x-api-key header or Authorization bearer token.' };
      }

      const submittedHash = hashApiKey(rawKey);
      for (const record of keyMap.values()) {
        if (safeEqual(submittedHash, record.keyHash)) {
          return { authenticated: true, tier: record.tier, name: record.name, keyId: record.keyId };
        }
      }

      return { authenticated: false, error: 'Invalid API key.' };
    },

    addKey(record: ApiKeyRecord) {
      const normalized = normalizedRecord(record);
      if (normalized) keyMap.set(normalized.keyId, normalized);
    },

    removeKey(keyIdOrLegacyKey: string) {
      keyMap.delete(keyIdOrLegacyKey);
      keyMap.delete(stableLegacyKeyId(keyIdOrLegacyKey));
      if (keyIdOrLegacyKey.startsWith(KEY_PREFIX)) {
        const keyHash = hashApiKey(keyIdOrLegacyKey);
        for (const [keyId, record] of keyMap.entries()) {
          if (safeEqual(keyHash, record.keyHash)) {
            keyMap.delete(keyId);
          }
        }
      }
    },

    listKeys(): Array<Omit<ApiKeyStoredRecord, 'keyHash'>> {
      return [...keyMap.values()].map(({ keyHash: _keyHash, ...rest }) => rest);
    },
  };
}

function isValidRecord(value: unknown): value is ApiKeyRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const hasHashedKey = typeof record.keyHash === 'string' && HASH_RE.test(record.keyHash);
  const hasPlaintextKey = typeof record.key === 'string' && record.key.startsWith(KEY_PREFIX);
  return (
    (hasHashedKey || hasPlaintextKey) &&
    (record.keyId === undefined || (typeof record.keyId === 'string' && KEY_ID_RE.test(record.keyId))) &&
    typeof record.tier === 'string' &&
    VALID_TIERS.has(record.tier) &&
    typeof record.name === 'string' &&
    (record.createdAt === undefined || typeof record.createdAt === 'string')
  );
}

export function loadKeysFromEnv(envValue: string | undefined): ApiKeyRecord[] {
  if (!envValue) return [];

  try {
    const parsed = JSON.parse(envValue);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRecord).map((record) => ({
      ...record,
      createdAt: record.createdAt ?? new Date(0).toISOString(),
    }));
  } catch (err) {
    console.warn('ACHIOTE_API_KEYS: failed to parse JSON —', err instanceof Error ? err.message : String(err));
    return [];
  }
}
