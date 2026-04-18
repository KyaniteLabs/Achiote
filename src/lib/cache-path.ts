import os from 'node:os';
import path from 'node:path';
import { ResearchCache } from './research-cache.js';

export type MemberBerriesServerOptions = {
  cachePath?: string;
  enableCache?: boolean;
};

export function defaultCachePath(): string {
  if (process.env.MEMBER_BERRIES_CACHE_PATH) {
    return process.env.MEMBER_BERRIES_CACHE_PATH;
  }

  const cacheRoot = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
  return path.join(cacheRoot, 'member-berries', 'culture-cache.db');
}

export function createCache(options: MemberBerriesServerOptions): ResearchCache | null {
  if (options.enableCache === false) return null;
  return new ResearchCache(options.cachePath ?? defaultCachePath());
}
