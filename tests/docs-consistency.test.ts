import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('release documentation consistency', () => {
  it('keeps the PR template aligned with launch verification gates', () => {
    const template = fs.readFileSync('.github/pull_request_template.md', 'utf8');

    expect(template).toContain('`npm run check`');
    expect(template).toContain('`npm run package:smoke`');
    expect(template).toContain('`npm audit --audit-level=moderate`');
    expect(template).toContain('`npm pack --dry-run`');
    expect(template).toContain('`npm run docker:smoke` when Docker/runtime changes');
    expect(template).toContain('Browser/screenshot review when landing UI changes');
  });

  it('does not describe production CORS as wildcard-permissive', () => {
    const security = fs.readFileSync('SECURITY.md', 'utf8');

    expect(security).not.toContain('Access-Control-Allow-Origin: *');
    expect(security).not.toContain('permissive (`Access-Control-Allow-Origin: *`)');
    expect(security).toContain('Set `ACHIOTE_ALLOWED_ORIGINS` to the exact HTTPS origins allowed to call the service.');
  });

  it('does not list completed launch-hardening work as future roadmap work', () => {
    const roadmap = fs.readFileSync('docs/ROADMAP.md', 'utf8');

    expect(roadmap).toContain('Validated memory hint vocabulary data');
    expect(roadmap).toContain('Docker healthcheck and non-root runtime');
    expect(roadmap).toContain('Dietary/allergen/religious constraint-aware minimum cues');
    expect(roadmap).not.toContain('Move broad ingredient/research hint vocabulary into configurable data rather than code constants');
    expect(roadmap).not.toContain('Add dietary/allergen/religious constraints to substitutions');
    expect(roadmap).not.toMatch(/validate_recipe_output.*future/i);
  });
});
