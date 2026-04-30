import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

function runNodeScript(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        ACHIOTE_RATE_LIMIT_DB: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('hostile fake-provider torture flow', () => {
  it('declares an offline fake-provider torture command', () => {
    expect(pkg.scripts['torture:fake']).toBe('npm run build && node scripts/torture-smoke.mjs');
    expect(pkg.files).toContain('scripts/');
    expect(fs.existsSync('scripts/torture-smoke.mjs')).toBe(true);
  });

  it('declares the hellish fake-provider scenario catalog without live provider configuration', async () => {
    const result = await runNodeScript(['scripts/torture-smoke.mjs', '--list-json']);

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain('OPENAI_API_KEY');
    expect(result.stderr).not.toContain('ANTHROPIC_API_KEY');

    const marker = result.stdout
      .split('\n')
      .find((line) => line.startsWith('TORTURE_SUMMARY_JSON='));
    expect(marker).toBeDefined();

    const summary = JSON.parse(marker!.slice('TORTURE_SUMMARY_JSON='.length)) as {
      offlineOnly: boolean;
      total: number;
      scenarios: Array<{ id: string; status: string; findings: string[] }>;
    };
    const ids = summary.scenarios.map((scenario) => scenario.id);

    expect(summary.offlineOnly).toBe(true);
    expect(summary.total).toBeGreaterThanOrEqual(16);
    expect(ids).toEqual(expect.arrayContaining([
      'status_redaction',
      'context_overflow_recovery',
      'provider_secret_error_sanitized',
      'duplicate_loop_with_new_call',
      'incidental_dietary_gating',
      'explicit_substitution_stall',
      'beverage_minimum_cue',
      'generic_waffle_suppression',
      'malformed_tool_arguments',
      'malformed_tool_arguments_with_secret',
      'direct_minimum_cue_builds_dossier',
      'search_web_pressure_capped_no_browsing',
      'provider_identity_injection',
      'browser_claim_injection',
      'medical_claim_injection',
      'beverage_adaptation_under_constraints',
    ]));
    expect(summary.scenarios.every((scenario) => scenario.status === 'listed')).toBe(true);
  }, 60_000);

  it('makes finding summaries fail the torture command', () => {
    const script = fs.readFileSync('scripts/torture-smoke.mjs', 'utf8');

    expect(script).toContain('if (summary.findings > 0)');
    expect(script).toContain('process.exitCode = 1');
  });

  it('rejects fake GLM torture because GLM live tests use Anthropic-compatible endpoints', async () => {
    const child = spawn(process.execPath, ['scripts/torture-smoke.mjs', '--list-json'], {
      env: {
        ...process.env,
        ACHIOTE_TORTURE_PROVIDER: 'glm-4.5-air',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });

    expect(code).not.toBe(0);
    expect(stderr).toContain('Use scripts/live-ask-smoke.mjs or scripts/weak-cloud-overnight.mjs for GLM/Z.ai and OpenRouter live provider tests');
  });
});
