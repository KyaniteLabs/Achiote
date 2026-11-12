import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

describe('shipped OFL fonts carry their licence (AC-7)', () => {
  for (const dir of ['docs/landing/fonts', 'docs/landing/proof/fonts']) {
    it(`${dir} ships the Fraunces OFL text next to the font files`, () => {
      const file = path.join(root, dir, 'OFL-Fraunces.txt');
      expect(fs.existsSync(file), file).toBe(true);
      const text = fs.readFileSync(file, 'utf8');
      expect(text).toMatch(/Fraunces Project Authors/);
      expect(text).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    });
  }

  it('the npm package ships those licence files', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { files: string[] };
    expect(pkg.files).toContain('docs/landing/fonts/');
    expect(pkg.files).toContain('docs/landing/proof/');
  });
});
