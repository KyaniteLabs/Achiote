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
  keyId: string;
};

export type RequestIdentityInput = {
  authEnabled: boolean;
  authenticated?: AuthenticatedIdentity;
  headers: HeaderBag;
  remoteAddress?: string;
  trustProxy: boolean;
  trustedProxyIps?: string[];
};

export type AnonymousAskPolicyInput = {
  authEnabled: boolean;
  allowAnonymousAsk: boolean;
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
  demoPasswordConfigured: boolean;
  billingEnabled: boolean;
  anthropicApiKey?: string;
  anthropicAuthToken?: string;
  openaiProviderReady?: boolean;
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

function normalizeAddress(value: string | undefined): string {
  return (value || 'unknown').replace(/^::ffff:/, '').trim();
}

function isTrustedProxy(remoteAddress: string | undefined, trustedProxyIps: string[] | undefined): boolean {
  const normalizedRemote = normalizeAddress(remoteAddress);
  return (trustedProxyIps ?? []).map(normalizeAddress).includes(normalizedRemote);
}

function clientAddress(headers: HeaderBag, remoteAddress: string | undefined, trustProxy: boolean, trustedProxyIps?: string[]): string {
  if (trustProxy && isTrustedProxy(remoteAddress, trustedProxyIps)) {
    const forwardedFor = normalizedHeader(headers, 'x-forwarded-for');
    const chain = forwardedFor
      ?.split(',')
      .map((value) => normalizeAddress(value))
      .filter((value) => value && value !== 'unknown');

    if (chain?.length === 1) return chain[0];
    if (chain && chain.length > 1) {
      const downstreamProxyChain = chain.slice(1);
      const allDownstreamProxiesTrusted = downstreamProxyChain.every((address) => isTrustedProxy(address, trustedProxyIps));
      if (allDownstreamProxiesTrusted) return chain[0];
    }
  }
  return normalizeAddress(remoteAddress);
}

export function getRequestRateLimitIdentity(input: RequestIdentityInput): RequestRateLimitIdentity | null {
  if (input.authEnabled) {
    if (!input.authenticated) return null;
    return {
      tier: input.authenticated.tier,
      name: input.authenticated.name,
      keyId: `key:${input.authenticated.keyId}`,
    };
  }

  return {
    tier: 'free',
    name: 'anonymous',
    keyId: `anon:ip:${clientAddress(input.headers, input.remoteAddress, input.trustProxy, input.trustedProxyIps)}`,
  };
}

export function isAnonymousAskAllowed(input: AnonymousAskPolicyInput): boolean {
  return input.authEnabled || input.allowAnonymousAsk;
}

export function shouldApplyRateLimit(input: RateLimitGateInput): boolean {
  const contentType = input.contentType ?? '';
  if (!contentType.includes('application/json')) return false;
  if (typeof input.parsedBody !== 'object' || input.parsedBody === null) return false;
  const body = input.parsedBody as { message?: unknown; images?: unknown };
  const hasMessage = typeof body.message === 'string' && body.message.trim().length > 0;
  const hasImages = Array.isArray(body.images) && body.images.length > 0;
  return hasMessage || hasImages;
}

export function getHttpReadiness(input: HttpReadinessInput): HttpReadiness {
  const hasAnthropicCredential = Boolean(input.anthropicApiKey?.trim() || input.anthropicAuthToken?.trim());
  const hasModelProvider = hasAnthropicCredential || Boolean(input.openaiProviderReady);
  const checks: ReadinessCheck[] = [
    {
      name: 'apiKeys',
      ok: !input.authEnabled || input.apiKeyCount > 0 || input.demoPasswordConfigured || input.billingEnabled,
      message: input.authEnabled
        ? input.apiKeyCount > 0
          ? 'authentication is enabled and API keys are configured'
          : input.demoPasswordConfigured
            ? 'authentication is enabled via demo password'
            : input.billingEnabled
              ? 'authentication is enabled via Stripe billing'
              : 'authentication is enabled but ACHIOTE_API_KEYS is empty or invalid'
        : 'authentication is disabled for local/demo use',
    },
    {
      name: 'anthropicApiKey',
      ok: hasModelProvider,
      message: hasModelProvider
        ? 'Model provider is configured for /ask'
        : 'ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or local inference is missing; /ask cannot call the model',
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
