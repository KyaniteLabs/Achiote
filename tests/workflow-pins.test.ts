import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(__dirname, '..', '.github/workflows');

describe('CI actions are pinned by commit SHA (AC-5)', () => {
  for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    it(`${file}: every "uses:" is a 40-hex SHA`, () => {
      const unpinned = fs
        .readFileSync(path.join(dir, file), 'utf8')
        .split('\n')
        .map((line) => line.match(/^\s*(?:-\s+)?uses:\s*(\S+)/)?.[1])
        .filter((ref): ref is string => !!ref && !ref.startsWith('./') && !/@[0-9a-f]{40}$/.test(ref));
      expect(unpinned).toEqual([]);
    });
  }
});
