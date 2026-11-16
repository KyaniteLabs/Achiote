import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCacheWithStatus, defaultCachePath } from '../src/lib/cache-path.js';

describe('cache lives in the host plugin data dir (AC-4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses $PLUGIN_DATA/culture-cache.db when the host provides PLUGIN_DATA', () => {
    vi.stubEnv('ACHIOTE_CACHE_PATH', '');
    delete process.env.ACHIOTE_CACHE_PATH;
    vi.stubEnv('PLUGIN_DATA', '/var/tmp/hermes/plugin-data/achiote');
    expect(defaultCachePath()).toBe('/var/tmp/hermes/plugin-data/achiote/culture-cache.db');
  });

  it('ACHIOTE_CACHE_PATH still wins over PLUGIN_DATA', () => {
    vi.stubEnv('PLUGIN_DATA', '/var/tmp/hermes/plugin-data/achiote');
    vi.stubEnv('ACHIOTE_CACHE_PATH', '/tmp/explicit.db');
    expect(defaultCachePath()).toBe('/tmp/explicit.db');
  });

  it('ignores a relative or traversal PLUGIN_DATA and uses the XDG default', () => {
    delete process.env.ACHIOTE_CACHE_PATH;
    vi.stubEnv('XDG_CACHE_HOME', '/var/tmp/xdg-probe');
    for (const bad of ['relative/dir', '/tmp/../etc']) {
      vi.stubEnv('PLUGIN_DATA', bad);
      expect(defaultCachePath()).toBe('/var/tmp/xdg-probe/achiote/culture-cache.db');
    }
  });

  it('creates the PLUGIN_DATA directory and falls back to the home cache if it cannot', () => {
    delete process.env.ACHIOTE_CACHE_PATH;
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-pd-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-home-'));
    try {
      vi.stubEnv('PLUGIN_DATA', path.join(base, 'a', 'b'));
      const ok = createCacheWithStatus({});
      expect(ok.fallbackUsed).toBe(false);
      expect(fs.existsSync(path.join(base, 'a', 'b', 'culture-cache.db'))).toBe(true);
      ok.cache?.close();

      // PLUGIN_DATA parent is a regular file: directory creation fails, fallback is used.
      fs.writeFileSync(path.join(base, 'file'), 'x');
      vi.stubEnv('PLUGIN_DATA', path.join(base, 'file', 'sub'));
      vi.stubEnv('HOME', home);
      const bad = createCacheWithStatus({});
      expect(bad.fallbackUsed).toBe(true);
      bad.cache?.close();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
