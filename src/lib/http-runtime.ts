import type { Tier } from './auth.js';

export type HeaderBag = Record<string, string | string[] | undefined>;

export type RequestRateLimitIdentity = {
  tier: Tier;
  name: string;
  keyId: string;
};

export type AuthenticatedIdentity = {
  authenticated: true;
  tier: Tier;
  name: string;
  rawKey: string;
};

export type RequestIdentityInput = {
  authEnabled: boolean;
  authenticated?: AuthenticatedIdentity;
  headers: HeaderBag;
  remoteAddress?: string;
  trustProxy: boolean;
};

export type RateLimitGateInput = {
  contentType?: string;
  parsedBody: unknown;
};

export type ReadinessCheck = {
  name: 'apiKeys' | 'anthropicApiKey' | 'cache' | 'rateLimitPersistence';
  ok: boolean;
  message: string;
};

export type HttpReadinessInput = {
  authEnabled: boolean;
  apiKeyCount: number;
  anthropicApiKey?: string;
  cacheAvailable: boolean;
  rateLimitPersistenceConfigured: boolean;
};

export type HttpReadiness = {
  ready: boolean;
  status: 'ok' | 'degraded';
  checks: ReadinessCheck[];
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizedHeader(headers: HeaderBag, name: string): string | undefined {
  return firstHeader(headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]);
}

function clientAddress(headers: HeaderBag, remoteAddress: string | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const forwardedFor = normalizedHeader(headers, 'x-forwarded-for');
    const firstForwarded = forwardedFor?.split(',')[0]?.trim();
    if (firstForwarded) return firstForwarded;
  }
  return remoteAddress || 'unknown';
}

export function getRequestRateLimitIdentity(input: RequestIdentityInput): RequestRateLimitIdentity | null {
  if (input.authEnabled) {
    if (!input.authenticated) return null;
    return {
      tier: input.authenticated.tier,
      name: input.authenticated.name,
      keyId: `key:${input.authenticated.rawKey}`,
    };
  }

  const explicitSession = normalizedHeader(input.headers, 'x-session-id')?.trim();
  if (explicitSession) {
    return { tier: 'free', name: 'anonymous', keyId: `anon:session:${explicitSession}` };
  }

  return {
    tier: 'free',
    name: 'anonymous',
    keyId: `anon:ip:${clientAddress(input.headers, input.remoteAddress, input.trustProxy)}`,
  };
}

export function shouldApplyRateLimit(input: RateLimitGateInput): boolean {
  const contentType = input.contentType ?? '';
  if (!contentType.includes('application/json')) return false;
  if (typeof input.parsedBody !== 'object' || input.parsedBody === null) return false;
  const message = (input.parsedBody as { message?: unknown }).message;
  return typeof message === 'string' && message.trim().length > 0;
}

export function getHttpReadiness(input: HttpReadinessInput): HttpReadiness {
  const checks: ReadinessCheck[] = [
    {
      name: 'apiKeys',
      ok: !input.authEnabled || input.apiKeyCount > 0,
      message: input.authEnabled
        ? input.apiKeyCount > 0
          ? 'authentication is enabled and API keys are configured'
          : 'authentication is enabled but ACHIOTE_API_KEYS is empty or invalid'
        : 'authentication is disabled for local/demo use',
    },
    {
      name: 'anthropicApiKey',
      ok: typeof input.anthropicApiKey === 'string' && input.anthropicApiKey.trim().length > 0,
      message: input.anthropicApiKey?.trim()
        ? 'ANTHROPIC_API_KEY is configured for /ask'
        : 'ANTHROPIC_API_KEY is missing; /ask cannot call the model',
    },
    {
      name: 'cache',
      ok: input.cacheAvailable,
      message: input.cacheAvailable ? 'research cache is available' : 'research cache failed to initialize or fell back to a different path',
    },
    {
      name: 'rateLimitPersistence',
      ok: input.rateLimitPersistenceConfigured,
      message: input.rateLimitPersistenceConfigured
        ? 'rate-limit persistence is configured'
        : 'ACHIOTE_RATE_LIMIT_DB is not configured; quotas reset on restart',
    },
  ];

  const ready = checks.every((check) => check.ok);
  return { ready, status: ready ? 'ok' : 'degraded', checks };
}
