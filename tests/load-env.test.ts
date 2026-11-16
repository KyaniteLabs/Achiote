import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvFrom, loadPackageEnv } from '../src/lib/load-env.js';

const KEY = 'ACHIOTE_TEST_DOTENV_PROBE';

describe('.env loading (AC-3)', () => {
  const cwd = process.cwd();
  afterEach(() => {
    process.chdir(cwd);
    delete process.env[KEY];
  });

  it('never reads a .env from the current working directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-env-'));
    try {
      fs.writeFileSync(path.join(dir, '.env'), `${KEY}=from-cwd\n`);
      process.chdir(dir);
      loadPackageEnv();
      expect(process.env[KEY]).toBeUndefined();
    } finally {
      process.chdir(cwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads a .env from an explicit directory and tolerates a missing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'achiote-env-'));
    try {
      expect(() => loadEnvFrom(dir)).not.toThrow();
      fs.writeFileSync(path.join(dir, '.env'), `${KEY}=from-dir\n`);
      loadEnvFrom(dir);
      expect(process.env[KEY]).toBe('from-dir');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no entry point calls process.loadEnvFile() with the implicit cwd default', () => {
    for (const file of ['src/index.ts', 'src/cli.ts', 'src/http-server.ts']) {
      const text = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
      expect(text, file).not.toMatch(/process\.loadEnvFile\(\s*\)/);
    }
  });
});
