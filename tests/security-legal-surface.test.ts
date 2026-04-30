import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

describe('security and legal surface guardrails', () => {
  it('does not ship archived landing proposal drafts in the npm package', () => {
    const packageJson = JSON.parse(read('package.json')) as { files?: string[] };

    expect(packageJson.files).not.toContain('docs/landing/');
    expect(packageJson.files).not.toContain('docs/landing/copy-proposal.md');
    expect(packageJson.files).not.toContain('docs/landing/audit-proposal-may2026.md');
  });

  it('keeps public landing copy explicit that host AI does web search, not Achiote itself', () => {
    const landing = read('docs/landing/index.html');
    const auditProposal = read('docs/landing/audit-proposal-may2026.md');
    const copyProposal = read('docs/landing/copy-proposal.md');
    const readme = read('README.md');
    const architecture = read('docs/ARCHITECTURE.md');

    expect(landing).toContain('Your host AI can search the web; Achiote plans the research strategy.');
    expect(copyProposal).toContain('Your host AI can search the web; Achiote plans the research strategy');
    expect(auditProposal).toContain('Your host AI can search the web; Achiote plans the research strategy');
    expect(`${landing}\n${auditProposal}\n${copyProposal}\n${readme}\n${architecture}`).not.toMatch(/\bAchiote\s+(?:searches|browses|scrapes)\s+(?:the\s+)?web\b/i);
    expect(architecture).toContain('The server does not browse the web itself.');
  });

  it('keeps medical and legal disclaimers visible in public safety and support surfaces', () => {
    const safety = read('docs/landing/safety.html');
    const support = read('docs/landing/support.html');
    const runbook = read('docs/LAUNCH_RUNBOOK.md');
    const auditProposal = read('docs/landing/audit-proposal-may2026.md');
    const copyProposal = read('docs/landing/copy-proposal.md');

    expect(safety).toContain('not medical advice, nutrition advice, allergy advice');
    expect(support).toContain('Do not send card numbers, raw API keys, or sensitive family details');
    expect(runbook).toContain('Do not ask users to send raw API keys, card numbers, or sensitive family details');
    expect(runbook).toContain('accounting, or legal obligations');
    expect(`${auditProposal}\n${copyProposal}`).not.toMatch(/\bremove\b.{0,40}\bmedical disclaimer\b/i);
  });

  it('keeps /ask error streaming on the sanitized error path', () => {
    const server = read('src/http-server.ts');

    expect(server).toContain('sanitizeAskError');
    expect(server).toContain("code: 'model_provider_failed'");
    expect(server).not.toContain("send('error', { message: err instanceof Error ? err.message : 'Unknown error' });");
  });

  it('keeps production deployment secrets behind external env files', () => {
    const rootCompose = read('docker-compose.yml');
    const runbook = read('docs/LAUNCH_RUNBOOK.md');
    const deployScript = read('deploy-achiote.sh');

    expect(rootCompose).toContain('env_file:');
    expect(rootCompose).toContain('${ACHIOTE_ENV_FILE:-/docker/achiote/env/achiote.env}');
    expect(rootCompose).not.toMatch(/\b(?:ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|GLM_API_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|ACHIOTE_API_KEYS|ACHIOTE_DEMO_PASSWORD)\s*=/);
    expect(runbook).toContain('/docker/achiote/env/achiote.env');
    expect(runbook).toContain('Do not run unredacted `docker compose config` or inspect container environment output in shared logs.');
    expect(deployScript).toContain('--env-file "$ENV_FILE"');
    expect(deployScript).not.toContain('docker inspect');
  });

  it('keeps global seed data provenance-bounded and free of provider, credential, browsing, medical, and legal claims', () => {
    const seedSurface = [
      read('src/data/global-coverage-matrix.json'),
      read('src/data/reference-seed-queue.json'),
      read('src/data/cache-warming-manifest.json'),
      read('src/data/reference-source-registry.json'),
      read('src/lib/reference-seed-planner.ts'),
      read('src/lib/reference-seed-operator.ts'),
      read('scripts/reference-seed-operator.mjs'),
    ].join('\n');

    expect(seedSurface).toContain('curated seed hypothesis');
    expect(seedSurface).toContain('Achiote does not browse');
    expect(seedSurface).toContain('CC0-1.0');
    expect(seedSurface).not.toMatch(/\b(?:OpenAI|Anthropic|Claude|GPT|GLM|Zhipu|provider returned|live web|Achiote browses|Achiote searches|Achiote scrapes)\b/i);
    expect(seedSurface).not.toMatch(/\b(?:api[_-]?key|secret|token|password)\b/i);
    expect(seedSurface).not.toMatch(/\b(?:medical advice|legal advice|cure|treats|prevents|lowers cholesterol|diagnoses)\b/i);
    expect(seedSurface).not.toMatch(/\b(?:rawMemory|memoryText|prompt_text|user prompt)\b/i);
  });
});
