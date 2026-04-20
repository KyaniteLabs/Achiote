import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { ResearchCacheEntry, ResearchRecord } from './types.js';

export class ResearchCache {
  private static readonly MAX_DATA_SIZE = 512 * 1024; // 512 KB
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_cache (
        dish_family TEXT NOT NULL,
        region TEXT NOT NULL,
        research_data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        hit_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (dish_family, region)
      )
    `);
  }

  store(dishFamily: string, region: string, researchData: string): void {
    if (Buffer.byteLength(researchData, 'utf8') > ResearchCache.MAX_DATA_SIZE) {
      throw new Error(`Research data exceeds maximum cache entry size (${ResearchCache.MAX_DATA_SIZE} bytes)`);
    }
    try {
      this.db.prepare(
        `INSERT OR REPLACE INTO research_cache (dish_family, region, research_data, created_at, hit_count)
         VALUES (?, ?, ?, datetime('now'), 0)`
      ).run(dishFamily, region, researchData);
    } catch (err) {
      console.warn('Research cache store failed:', err instanceof Error ? err.message : String(err));
    }
  }

  storeResearchRecord(dishFamily: string, region: string, record: ResearchRecord): void {
    this.store(dishFamily, region, JSON.stringify(record));
  }

  getResearchRecord(dishFamily: string, region: string): ResearchRecord | null {
    const entry = this.get(dishFamily, region);
    if (!entry) return null;
    try {
      return JSON.parse(entry.researchData) as ResearchRecord;
    } catch {
      return null;
    }
  }

  get(dishFamily: string, region: string): ResearchCacheEntry | null {
    try {
      const stmt = this.db.transaction(() => {
        this.db.prepare(
          'UPDATE research_cache SET hit_count = hit_count + 1 WHERE dish_family = ? AND region = ?'
        ).run(dishFamily, region);

        return this.db.prepare(
          "SELECT dish_family AS dishFamily, region, research_data AS researchData, created_at AS createdAt, hit_count AS hitCount FROM research_cache WHERE dish_family = ? AND region = ?"
        ).get(dishFamily, region) as ResearchCacheEntry | undefined;
      });

      return stmt() ?? null;
    } catch {
      return null;
    }
  }

  close(): void {
    this.db.close();
  }
}
