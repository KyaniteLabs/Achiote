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

  it('keeps public pricing surfaces aligned', () => {
    const surfaces = [
      fs.readFileSync('docs/landing/index.html', 'utf8'),
      fs.readFileSync('docs/landing/ai-search.html', 'utf8'),
      fs.readFileSync('docs/landing/llms.txt', 'utf8'),
    ].join('\n');

    for (const required of [
      '$9/month',
      '$59/year',
      '$49 one-time',
      '$39/month',
      '$149 one-time',
      '$299/month',
      '$1,500',
    ]) {
      expect(surfaces).toContain(required);
    }
    expect(surfaces).not.toMatch(/\bPro\b[^.\n]*\$19/i);
  });

  it('documents the 30-day viability experiment gates', () => {
    const experiment = fs.readFileSync('docs/VIABILITY_EXPERIMENT.md', 'utf8');
    const runbook = fs.readFileSync('docs/LAUNCH_RUNBOOK.md', 'utf8');

    for (const required of [
      '30-Day Viability Experiment',
      '30 strangers',
      'under 3 minutes',
      '40% say it feels more useful than generic AI',
      '10% pay',
      'feedback_closer / ask_succeeded',
      'do not scale paid acquisition',
    ]) {
      expect(experiment).toContain(required);
    }
    expect(runbook).toContain('docs/VIABILITY_EXPERIMENT.md');
  });
});
