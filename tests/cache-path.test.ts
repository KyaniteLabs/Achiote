import { describe, it, expect, afterEach } from 'vitest';
import { defaultCachePath } from '../src/lib/cache-path.js';

describe('defaultCachePath', () => {
  const originalEnv = process.env.ACHIOTE_CACHE_PATH;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ACHIOTE_CACHE_PATH = originalEnv;
    } else {
      delete process.env.ACHIOTE_CACHE_PATH;
    }
  });

  it('rejects non-.db file extensions', () => {
    process.env.ACHIOTE_CACHE_PATH = '/tmp/cache.sqlite';
    expect(() => defaultCachePath()).toThrow(/must end with \.db/);
  });

  it('rejects bare directory path without extension', () => {
    process.env.ACHIOTE_CACHE_PATH = '/tmp/some-directory';
    expect(() => defaultCachePath()).toThrow(/must end with \.db/);
  });

  it('accepts valid .db path', () => {
    process.env.ACHIOTE_CACHE_PATH = '/tmp/test-cache.db';
    expect(defaultCachePath()).toContain('test-cache.db');
  });

  it('rejects path traversal with ..', () => {
    process.env.ACHIOTE_CACHE_PATH = '/tmp/../../../etc/passwd.db';
    expect(() => defaultCachePath()).toThrow(/path traversal/);
  });

  it('returns XDG default when env var is unset', () => {
    delete process.env.ACHIOTE_CACHE_PATH;
    const result = defaultCachePath();
    expect(result).toContain('achiote');
    expect(result).toMatch(/\.db$/);
  });
});
