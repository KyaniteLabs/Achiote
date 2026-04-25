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

function monthWindow(now: number): { periodStart: number; periodEnd: number } {
  return {
    periodStart: Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1),
    periodEnd: Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1),
  };
}

function storageKey(windowKey: string): string {
  return createHash('sha256').update(windowKey).digest('hex');
}

function unlimitedWebResult(): RateLimitResult {
  const { periodEnd } = monthWindow(Date.now());
  return { allowed: true, remaining: Infinity, limit: Infinity, resetAt: periodEnd };
}

export function createRateLimiter(dbPath?: string) {
  const usage = new Map<string, UsageEntry>();
  let lastSweep = 0;
  let db: Database.Database | undefined;

  if (dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.exec(`
      CREATE TABLE IF NOT EXISTS rate_usage (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        period_start INTEGER NOT NULL
      )
    `);
  }

  const selectRow = db?.prepare('SELECT count, period_start FROM rate_usage WHERE key = ?');
  const insertRow = db?.prepare('INSERT INTO rate_usage (key, count, period_start) VALUES (?, ?, ?)');
  const updateRow = db?.prepare('UPDATE rate_usage SET count = ?, period_start = ? WHERE key = ?');
  const deleteRow = db?.prepare('DELETE FROM rate_usage WHERE key = ?');
  const deleteStaleRows = db?.prepare('DELETE FROM rate_usage WHERE period_start != ?');

  const dbCheck = db?.transaction((key: string, limit: number, periodStart: number, periodEnd: number): RateLimitResult => {
    const row = selectRow!.get(key) as { count: number; period_start: number } | undefined;
    const count = row && row.period_start === periodStart ? row.count : 0;

    if (count >= limit) {
      if (!row) insertRow!.run(key, count, periodStart);
      else if (row.period_start !== periodStart) updateRow!.run(count, periodStart, key);
      return { allowed: false, remaining: 0, limit, resetAt: periodEnd };
    }

    const nextCount = count + 1;
    if (!row) insertRow!.run(key, nextCount, periodStart);
    else updateRow!.run(nextCount, periodStart, key);

    return {
      allowed: true,
      remaining: Math.max(0, limit - nextCount),
      limit,
      resetAt: periodEnd,
    };
  });

  function sweepStaleEntries(): void {
    const now = Date.now();
    if (now - lastSweep < 60_000) return;
    lastSweep = now;
    const { periodStart } = monthWindow(now);

    if (db) {
      deleteStaleRows?.run(periodStart);
      return;
    }

    for (const [key, entry] of usage) {
      if (entry.periodStart !== periodStart) {
        usage.delete(key);
      }
    }
  }

  function checkLimit(scope: 'mcp' | 'web', keyId: string, limit: number): RateLimitResult {
    sweepStaleEntries();
    const now = Date.now();
    const { periodStart, periodEnd } = monthWindow(now);
    const sk = storageKey(`${scope}:${keyId}`);

    if (dbCheck) {
      return dbCheck.immediate(sk, limit, periodStart, periodEnd);
    }

    let entry = usage.get(sk);
    if (!entry || entry.periodStart !== periodStart) {
      entry = { count: 0, periodStart };
      usage.set(sk, entry);
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
  }

  return {
    checkMcpLimit(tier: Tier, keyId: string): RateLimitResult {
      const limit = getTierLimits(tier).mcpCallsPerMonth;
      const { periodEnd } = monthWindow(Date.now());
      if (!isFinite(limit)) {
        return { allowed: true, remaining: Infinity, limit: Infinity, resetAt: periodEnd };
      }
      return checkLimit('mcp', keyId, limit);
    },

    checkWebLimit(tier: Tier, sessionId: string): RateLimitResult {
      const limit = getTierLimits(tier).webReconstructions;
      if (!isFinite(limit)) {
        return unlimitedWebResult();
      }
      return checkLimit('web', sessionId, limit);
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
