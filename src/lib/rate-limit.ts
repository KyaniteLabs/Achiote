import { createHash } from 'node:crypto';
import type { Tier } from './auth.js';
import { getTierLimits } from './auth.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

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

export function createRateLimiter(dbPath?: string) {
  const usage = new Map<string, UsageEntry>();
  let lastSweep = 0;
  let db: Database.Database | undefined;

  if (dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS rate_usage (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        period_start INTEGER NOT NULL
      )
    `);
    const rows = db.prepare('SELECT key, count, period_start FROM rate_usage').all() as Array<{ key: string; count: number; period_start: number }>;
    for (const row of rows) {
      usage.set(row.key, { count: row.count, periodStart: row.period_start });
    }
  }

  function storageKey(windowKey: string): string {
    return createHash('sha256').update(windowKey).digest('hex');
  }

  const upsert = db?.prepare('INSERT OR REPLACE INTO rate_usage (key, count, period_start) VALUES (?, ?, ?)');
  const deleteRow = db?.prepare('DELETE FROM rate_usage WHERE key = ?');

  function persistEntry(sk: string, entry: UsageEntry): void {
    upsert?.run(sk, entry.count, entry.periodStart);
  }

  function sweepStaleEntries(): void {
    const now = Date.now();
    if (now - lastSweep < 60_000) return;
    lastSweep = now;
    const currentPeriod = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
    for (const [key, entry] of usage) {
      if (entry.periodStart !== currentPeriod) {
        usage.delete(key);
        deleteRow?.run(key);
      }
    }
  }

  return {
    checkMcpLimit(tier: Tier, keyId: string): RateLimitResult {
      sweepStaleEntries();
      const limits = getTierLimits(tier);
      const limit = limits.mcpCallsPerMonth;
      const now = Date.now();
      const sk = storageKey(`mcp:${keyId}`);

      const periodStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
      const periodEnd = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1);

      let entry = usage.get(sk);
      if (!entry || entry.periodStart !== periodStart) {
        entry = { count: 0, periodStart };
        usage.set(sk, entry);
      }

      if (entry.count >= limit) {
        return { allowed: false, remaining: 0, limit, resetAt: periodEnd };
      }

      entry.count++;
      persistEntry(sk, entry);
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

      const sk = storageKey(`web:${sessionId}`);
      const now = Date.now();
      const periodStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
      const periodEnd = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1);

      let entry = usage.get(sk);
      if (!entry || entry.periodStart !== periodStart) {
        entry = { count: 0, periodStart };
        usage.set(sk, entry);
      }

      if (entry.count >= limit) {
        return { allowed: false, remaining: 0, limit, resetAt: periodEnd };
      }

      entry.count++;
      persistEntry(sk, entry);
      return { allowed: true, remaining: limit - entry.count, limit, resetAt: periodEnd };
    },

    resetUsage(keyId: string) {
      for (const prefix of ['mcp:', 'web:']) {
        const sk = storageKey(`${prefix}${keyId}`);
        usage.delete(sk);
        deleteRow?.run(sk);
      }
    },

    close(): void {
      db?.close();
    },
  };
}
