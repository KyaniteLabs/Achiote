import type { Tier } from './auth.js';
import { getTierLimits } from './auth.js';

interface UsageEntry {
  count: number;
  periodStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

export function createRateLimiter() {
  const usage = new Map<string, UsageEntry>();
  let lastSweep = 0;

  function sweepStaleEntries(): void {
    const now = Date.now();
    if (now - lastSweep < 60_000) return; // sweep at most once per minute
    lastSweep = now;
    const currentPeriod = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
    for (const [key, entry] of usage) {
      if (entry.periodStart !== currentPeriod) {
        usage.delete(key);
      }
    }
  }

  return {
    checkMcpLimit(tier: Tier, keyId: string): RateLimitResult {
      sweepStaleEntries();
      const limits = getTierLimits(tier);
      const limit = limits.mcpCallsPerMonth;
      const now = Date.now();
      const windowKey = `mcp:${keyId}`;

      const periodStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
      const periodEnd = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1);

      let entry = usage.get(windowKey);
      if (!entry || entry.periodStart !== periodStart) {
        entry = { count: 0, periodStart };
        usage.set(windowKey, entry);
      }

      if (entry.count >= limit) {
        return { allowed: false, remaining: 0, limit, resetAt: periodEnd };
      }

      entry.count++;
      return {
        allowed: true,
        remaining: Math.max(0, limit - entry.count),
        limit,
        resetAt: periodEnd,
      };
    },

    checkWebLimit(tier: Tier, sessionId: string): RateLimitResult {
      sweepStaleEntries();
      const limits = getTierLimits(tier);
      const limit = limits.webReconstructions;
      if (!isFinite(limit)) {
        return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, limit: Number.MAX_SAFE_INTEGER, resetAt: Date.now() + 60_000 };
      }

      const windowKey = `web:${sessionId}`;
      const now = Date.now();
      const periodStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
      const periodEnd = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1);

      let entry = usage.get(windowKey);
      if (!entry || entry.periodStart !== periodStart) {
        entry = { count: 0, periodStart };
        usage.set(windowKey, entry);
      }

      if (entry.count >= limit) {
        return { allowed: false, remaining: 0, limit, resetAt: periodEnd };
      }

      entry.count++;
      return { allowed: true, remaining: limit - entry.count, limit, resetAt: periodEnd };
    },

    resetUsage(keyId: string) {
      usage.delete(`mcp:${keyId}`);
      usage.delete(`web:${keyId}`);
    },
  };
}
