import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { Tier } from './auth.js';
import type { RateLimitResult } from './rate-limit.js';
import { getRequestRateLimitIdentity, isAnonymousAskAllowed } from './http-runtime.js';

export type AuthedRequest = { tier: Tier; name: string; keyId: string } | null;

type RequestIdentityInput = {
  headers: IncomingHttpHeaders;
  remoteAddress?: string;
};

export type AccountAccessInput = {
  authEnabled: boolean;
  allowAnonymousAsk: boolean;
  demoPassword?: string;
  trustProxy: boolean;
  trustedProxyIps: string[];
  anonymousWebLimitOverride?: number;
  authenticator: {
    authenticate(rawKey: string | undefined): { authenticated: true; tier: Tier; name: string; keyId: string } | { authenticated: false; error: string };
  };
  rateLimiter: {
    checkWebLimit(tier: Tier, keyId: string, limitOverride?: number): RateLimitResult;
    checkMcpLimit(tier: Tier, keyId: string): RateLimitResult;
  };
  billingDb?: {
    authenticateApiKey(rawKey: string): { tier: Tier; name: string; keyId: string } | null;
    getCustomerIdByKeyId(keyId: string): string | null;
    deductMcpCredit(customerId: string): boolean;
    deductWebCredit(customerId: string): boolean;
  } | null;
};

export function createAccountAccess(input: AccountAccessInput) {
  function authenticate(request: RequestIdentityInput & { apiKey?: string; bearer?: string; demoPassword?: string }): AuthedRequest {
    if (input.demoPassword && request.demoPassword && safeEqual(request.demoPassword, input.demoPassword)) {
      return { tier: 'pro', name: 'demo-user', keyId: 'demo' };
    }

    const rawKey = request.apiKey ?? request.bearer;
    const result = input.authEnabled
      ? input.authenticator.authenticate(rawKey)
      : { authenticated: false as const, error: 'auth disabled' };

    if (result.authenticated) {
      return getRequestRateLimitIdentity({
        authEnabled: input.authEnabled,
        authenticated: result,
        headers: request.headers,
        remoteAddress: request.remoteAddress,
        trustProxy: input.trustProxy,
        trustedProxyIps: input.trustedProxyIps,
      });
    }

    if (rawKey && input.billingDb) {
      const billingAuth = input.billingDb.authenticateApiKey(rawKey);
      if (billingAuth) return { tier: billingAuth.tier, name: billingAuth.name, keyId: billingAuth.keyId };
    }

    return getRequestRateLimitIdentity({
      authEnabled: input.authEnabled,
      authenticated: undefined,
      headers: request.headers,
      remoteAddress: request.remoteAddress,
      trustProxy: input.trustProxy,
      trustedProxyIps: input.trustedProxyIps,
    });
  }

  function anonymousProductAccessAllowed(): boolean {
    return isAnonymousAskAllowed({ authEnabled: input.authEnabled, allowAnonymousAsk: input.allowAnonymousAsk });
  }

  function webLimit(authed: AuthedRequest): RateLimitResult {
    if (!authed) return { allowed: false, remaining: 0, limit: 0, resetAt: Date.now() };
    const override = !input.authEnabled && input.allowAnonymousAsk ? input.anonymousWebLimitOverride : undefined;
    return input.rateLimiter.checkWebLimit(authed.tier, authed.keyId, override);
  }

  function mcpLimit(authed: AuthedRequest): RateLimitResult {
    if (!authed) return { allowed: false, remaining: 0, limit: 0, resetAt: Date.now() };
    return input.rateLimiter.checkMcpLimit(authed.tier, authed.keyId);
  }

  function spendCredit(authed: AuthedRequest, scope: 'mcp' | 'web'): boolean {
    if (!authed || !input.billingDb) return false;
    const customerId = input.billingDb.getCustomerIdByKeyId(authed.keyId);
    if (!customerId) return false;
    return scope === 'mcp' ? input.billingDb.deductMcpCredit(customerId) : input.billingDb.deductWebCredit(customerId);
  }

  return {
    authenticate,
    anonymousProductAccessAllowed,
    webLimit,
    mcpLimit,
    spendCredit,
  };
}

export function rateLimitHeaders(limitResult: Pick<RateLimitResult, 'remaining' | 'limit' | 'resetAt'>): Record<string, string> {
  return {
    'X-RateLimit-Remaining': String(limitResult.remaining),
    'X-RateLimit-Limit': String(limitResult.limit),
    'X-RateLimit-Reset': String(Math.ceil(limitResult.resetAt / 1000)),
  };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
