import os from 'node:os';
import path from 'node:path';
import { ResearchCache } from './research-cache.js';

export type AchioteServerOptions = {
  cachePath?: string;
  enableCache?: boolean;
};

export function defaultCachePath(): string {
  if (process.env.ACHIOTE_CACHE_PATH) {
    const raw = process.env.ACHIOTE_CACHE_PATH;
    const envPath = path.resolve(raw);
    if (raw.split(/[/\\]/).some(seg => seg === '..')) {
      throw new Error('ACHIOTE_CACHE_PATH must not contain path traversal');
    }
    if (!envPath.endsWith('.db')) {
      throw new Error('ACHIOTE_CACHE_PATH must end with .db');
    }
    return envPath;
  }

  const cacheRoot = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
  return path.join(cacheRoot, 'achiote', 'culture-cache.db');
}

export function createCache(options: AchioteServerOptions): ResearchCache | null {
  if (options.enableCache === false) return null;
  const dbPath = options.cachePath ?? defaultCachePath();
  try {
    return new ResearchCache(dbPath);
  } catch (err) {
    console.warn(`Cache init failed for ${dbPath}, using fallback:`, err instanceof Error ? err.message : String(err));
    return new ResearchCache(path.join(os.homedir(), '.cache', 'achiote', 'culture-cache.db'));
  }
}
