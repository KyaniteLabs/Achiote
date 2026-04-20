import type { Tier } from './auth.js';
import { getTierLimits } from './auth.js';

interface WindowEntry {
  timestamp: number;
  count: number;
}

interface LimiterState {
  windows: Map<string, WindowEntry[]>;
  usage: Map<string, number>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_WINDOWS = 60;

export function createRateLimiter() {
  const state: LimiterState = {
    windows: new Map(),
    usage: new Map(),
  };

  function pruneOldWindows(now: number, entries: WindowEntry[]): WindowEntry[] {
    const cutoff = now - MAX_WINDOWS * WINDOW_MS;
    return entries.filter((e) => e.timestamp > cutoff);
  }

  return {
    checkMcpLimit(tier: Tier, keyId: string): RateLimitResult {
      const limits = getTierLimits(tier);
      const limit = limits.mcpCallsPerMonth;
      const now = Date.now();
      const windowKey = `mcp:${keyId}`;

      let entries = state.windows.get(windowKey) ?? [];
      entries = pruneOldWindows(now, entries);

      const currentWindow = Math.floor(now / WINDOW_MS);
      let entry = entries.find((e) => e.timestamp === currentWindow);
      if (!entry) {
        entry = { timestamp: currentWindow, count: 0 };
        entries.push(entry);
      }

      const usage = state.usage.get(windowKey) ?? 0;
      const totalThisMonth = usage;

      if (totalThisMonth >= limit) {
        state.windows.set(windowKey, entries);
        return { allowed: false, remaining: 0, limit, resetAt: currentWindow * WINDOW_MS + WINDOW_MS };
      }

      entry.count++;
      state.usage.set(windowKey, totalThisMonth + 1);
      state.windows.set(windowKey, entries);

      return {
        allowed: true,
        remaining: Math.max(0, limit - totalThisMonth - 1),
        limit,
        resetAt: (currentWindow + 1) * WINDOW_MS,
      };
    },

    checkWebLimit(tier: Tier, sessionId: string): RateLimitResult {
      const limits = getTierLimits(tier);
      const limit = limits.webReconstructions;
      if (!isFinite(limit)) {
        return { allowed: true, remaining: Infinity, limit: Infinity, resetAt: Date.now() + 60_000 };
      }

      const windowKey = `web:${sessionId}`;
      const usage = state.usage.get(windowKey) ?? 0;

      if (usage >= limit) {
        return { allowed: false, remaining: 0, limit, resetAt: Date.now() + 60_000 };
      }

      state.usage.set(windowKey, usage + 1);
      return { allowed: true, remaining: limit - usage - 1, limit, resetAt: Date.now() + 60_000 };
    },

    resetUsage(keyId: string) {
      state.usage.delete(`mcp:${keyId}`);
      state.usage.delete(`web:${keyId}`);
      state.windows.delete(`mcp:${keyId}`);
      state.windows.delete(`web:${keyId}`);
    },
  };
}
