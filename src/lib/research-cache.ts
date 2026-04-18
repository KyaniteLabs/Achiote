import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { ResearchCacheEntry } from './types.js';

export class ResearchCache {
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
    this.db.prepare(
      `INSERT OR REPLACE INTO research_cache (dish_family, region, research_data, created_at, hit_count)
       VALUES (?, ?, ?, datetime('now'), 0)`
    ).run(dishFamily, region, researchData);
  }

  get(dishFamily: string, region: string): ResearchCacheEntry | null {
    this.db.prepare(
      'UPDATE research_cache SET hit_count = hit_count + 1 WHERE dish_family = ? AND region = ?'
    ).run(dishFamily, region);

    const row = this.db.prepare(
      "SELECT dish_family AS dishFamily, region, research_data AS researchData, created_at AS createdAt, hit_count AS hitCount FROM research_cache WHERE dish_family = ? AND region = ?"
    ).get(dishFamily, region) as ResearchCacheEntry | undefined;

    return row ?? null;
  }

  close(): void {
    this.db.close();
  }
}
