import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

describe('package distribution metadata', () => {
  it('declares install, type, executable, and source-control metadata', () => {
    expect(pkg.license).toBe('MIT');
    expect(pkg.types).toBe('dist/index.d.ts');
    expect(pkg.bin).toEqual({ 'member-berries': 'bin/member-berries.mjs' });
    expect(pkg.exports).toEqual({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
    });
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/Pastorsimon1798/member-berries.git',
    });
    expect(pkg.bugs).toEqual({
      url: 'https://github.com/Pastorsimon1798/member-berries/issues',
    });
    expect(pkg.homepage).toBe('https://github.com/Pastorsimon1798/member-berries#readme');
    expect(pkg.engines.node).toBe('>=22.0.0');
  });

  it('publishes only intentional package files', () => {
    expect(pkg.files).toEqual([
      'bin/',
      'dist/',
      'skill/',
      'docs/ARCHITECTURE.md',
      'docs/ROADMAP.md',
      'docs/SELF_HOSTED_RUNNER.md',
      'README.md',
      'LICENSE',
    ]);
  });

  it('has reproducible quality and packaging scripts', () => {
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.check).toBe('npm run typecheck && npm run build && npm test');
    expect(pkg.scripts['pack:check']).toBe('npm run check && npm run package:smoke && npm pack --dry-run');
    expect(pkg.scripts['package:smoke']).toBe('node scripts/package-smoke.mjs');
  });
});
