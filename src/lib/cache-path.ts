import os from 'node:os';
import path from 'node:path';
import { ResearchCache } from './research-cache.js';

export type AchioteServerOptions = {
  cachePath?: string;
  enableCache?: boolean;
};

export type CacheInitStatus = {
  cache: ResearchCache | null;
  requestedPath?: string;
  activePath?: string;
  fallbackUsed: boolean;
  error?: string;
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

export function createCacheWithStatus(options: AchioteServerOptions): CacheInitStatus {
  if (options.enableCache === false) return { cache: null, fallbackUsed: false };
  const dbPath = options.cachePath ?? defaultCachePath();
  try {
    return { cache: new ResearchCache(dbPath), requestedPath: dbPath, activePath: dbPath, fallbackUsed: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const fallbackPath = path.join(os.homedir(), '.cache', 'achiote', 'culture-cache.db');
    console.warn(`Cache init failed for ${dbPath}, using fallback:`, error);
    try {
      return {
        cache: new ResearchCache(fallbackPath),
        requestedPath: dbPath,
        activePath: fallbackPath,
        fallbackUsed: true,
        error,
      };
    } catch (fallbackErr) {
      const fallbackError = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      console.warn(`Fallback cache init failed for ${fallbackPath}:`, fallbackError);
      return {
        cache: null,
        requestedPath: dbPath,
        activePath: fallbackPath,
        fallbackUsed: true,
        error: `${error}; fallback failed: ${fallbackError}`,
      };
    }
  }
}

export function createCache(options: AchioteServerOptions): ResearchCache | null {
  return createCacheWithStatus(options).cache;
}
