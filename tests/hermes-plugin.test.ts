import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// @ts-expect-error -- plain .mjs helper script without type declarations
import { catalogEntry, driftedFiles, expectedFiles, PLUGIN_DIR } from '../scripts/hermes-plugin.mjs';

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, rel), 'utf8'));

// Fields Hermes' portable reader accepts (hermes_cli/agent_plugins.py _PLUGIN_FIELDS); anything
// else is reported as a diagnostic at admission.
const ALLOWED_PLUGIN_FIELDS = new Set([
  '$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions',
]);

describe('Hermes plugin package (plugins/achiote)', () => {
  it('is in sync with its sources (run `npm run hermes:sync` if this fails)', () => {
    expect(driftedFiles()).toEqual([]);
  });

  it('pins the npx launcher and plugin version to package.json exactly', () => {
    expect(read('plugin.json').version).toBe(pkg.version);
    const server = read('mcp.json').mcpServers.achiote;
    expect(server).toEqual({ type: 'stdio', command: 'npx', args: ['-y', `achiote@${pkg.version}`] });
  });

  it('uses only manifest fields Hermes accepts and a valid portable name', () => {
    const manifest = read('plugin.json');
    for (const key of Object.keys(manifest)) expect(ALLOWED_PLUGIN_FIELDS.has(key)).toBe(true);
    expect(manifest.name).toMatch(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  });

  it('ships the skill under a directory whose name matches its frontmatter name', () => {
    const skill = fs.readFileSync(path.join(PLUGIN_DIR, 'skills/achiote/SKILL.md'), 'utf8');
    expect(skill).toMatch(/^---\nname: achiote\n/);
  });

  it('ships a 2:1 catalog banner and a square icon', () => {
    const size = (rel: string) => {
      const buf = fs.readFileSync(path.join(PLUGIN_DIR, rel));
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; // PNG IHDR
    };
    expect(size('banner.png')).toEqual({ w: 1200, h: 600 });
    const icon = size('icon.png');
    expect(icon.w).toBe(icon.h);
  });

  it('contains nothing the pipeline does not own except the README', () => {
    const owned = new Set([...Object.keys(expectedFiles()), 'README.md']);
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.relative(PLUGIN_DIR, path.join(dir, e.name))]
      );
    expect(walk(PLUGIN_DIR).filter((f) => !owned.has(f))).toEqual([]);
  });

  it('detects drift: a hand edit to a generated copy is reported', () => {
    const file = path.join(PLUGIN_DIR, 'skills/achiote/SKILL.md');
    const original = fs.readFileSync(file);
    try {
      fs.writeFileSync(file, Buffer.concat([original, Buffer.from('\nhand edit\n')]));
      expect(driftedFiles()).toContain('skills/achiote/SKILL.md');
    } finally {
      fs.writeFileSync(file, original);
    }
    expect(driftedFiles()).toEqual([]);
  });
});

describe('Hermes catalog entry', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';

  it('pins the full SHA, subdir, version label and a raw.githubusercontent banner at that SHA', () => {
    const entry = catalogEntry(sha);
    expect(entry).toContain(`sha: ${sha}\n`);
    expect(entry).toContain('subdir: plugins/achiote\n');
    expect(entry).toContain(`version: "${pkg.version}"\n`);
    expect(entry).toContain(`image: https://raw.githubusercontent.com/KyaniteLabs/Achiote/${sha}/plugins/achiote/banner.png\n`);
    expect(entry).toMatch(/^name: achiote\n/);
  });

  it.each(['master', 'v0.2.2', '0123456', `${sha}0`, sha.toUpperCase(), undefined])('refuses a non-SHA pin: %s', (bad) => {
    expect(() => catalogEntry(bad)).toThrow(/40-character/);
  });

  it('CLI exits non-zero for a bad pin', () => {
    expect(() =>
      execFileSync('node', ['scripts/hermes-plugin.mjs', 'catalog-entry', '--sha', 'main'], { cwd: ROOT, stdio: 'pipe' })
    ).toThrow();
  });
});
