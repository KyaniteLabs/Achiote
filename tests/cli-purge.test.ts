/**
 * `achiote purge` deletion path (src/cli-purge.ts). Pins the documented data-deletion mechanism:
 *   - dry run (no --yes) reports targets and deletes NOTHING,
 *   - --yes deletes the local store files (and their SQLite sidecars),
 *   - the rate-limit DB is only a target when ACHIOTE_RATE_LIMIT_DB is set.
 * Backs the retention posture in docs/PRIVACY-RETENTION.md.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { purgeTargets, runPurgeCommand } from '../src/cli-purge.js';

function collector(): { stream: Writable; text: () => string } {
  let buf = '';
  const stream = new Writable({ write(chunk, _enc, cb) { buf += chunk.toString(); cb(); } });
  return { stream, text: () => buf };
}

const SAVED = {
  cache: process.env.ACHIOTE_CACHE_PATH,
  billing: process.env.ACHIOTE_BILLING_DB,
  rateLimit: process.env.ACHIOTE_RATE_LIMIT_DB,
};

describe('achiote purge', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-purge-'));
    process.env.ACHIOTE_CACHE_PATH = path.join(dir, 'culture-cache.db');
    process.env.ACHIOTE_BILLING_DB = path.join(dir, 'billing.db');
    delete process.env.ACHIOTE_RATE_LIMIT_DB;
  });

  afterEach(() => {
    for (const [key, value] of [['ACHIOTE_CACHE_PATH', SAVED.cache], ['ACHIOTE_BILLING_DB', SAVED.billing], ['ACHIOTE_RATE_LIMIT_DB', SAVED.rateLimit]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists the cache and billing stores; rate-limit only when configured', () => {
    expect(purgeTargets().map((t) => t.label)).toEqual(['research cache', 'billing database']);
    process.env.ACHIOTE_RATE_LIMIT_DB = path.join(dir, 'rate.db');
    expect(purgeTargets().map((t) => t.label)).toContain('rate-limit database');
  });

  it('dry run reports targets and deletes nothing', () => {
    const cacheDb = process.env.ACHIOTE_CACHE_PATH!;
    fs.writeFileSync(cacheDb, 'data');
    const out = collector();

    const code = runPurgeCommand({ confirm: false, out: out.stream });

    expect(code).toBe(0);
    expect(out.text()).toMatch(/Dry run/);
    expect(out.text()).toContain(cacheDb);
    expect(out.text()).toMatch(/Nothing was deleted/);
    expect(fs.existsSync(cacheDb)).toBe(true);
  });

  it('--yes deletes the store files and their SQLite sidecars', () => {
    const cacheDb = process.env.ACHIOTE_CACHE_PATH!;
    const billingDb = process.env.ACHIOTE_BILLING_DB!;
    fs.writeFileSync(cacheDb, 'data');
    fs.writeFileSync(`${cacheDb}-wal`, 'wal');
    fs.writeFileSync(`${cacheDb}-shm`, 'shm');
    fs.writeFileSync(billingDb, 'data');
    const out = collector();

    const code = runPurgeCommand({ confirm: true, out: out.stream });

    expect(code).toBe(0);
    expect(fs.existsSync(cacheDb)).toBe(false);
    expect(fs.existsSync(`${cacheDb}-wal`)).toBe(false);
    expect(fs.existsSync(`${cacheDb}-shm`)).toBe(false);
    expect(fs.existsSync(billingDb)).toBe(false);
    expect(out.text()).toMatch(/removed/);
  });
});
