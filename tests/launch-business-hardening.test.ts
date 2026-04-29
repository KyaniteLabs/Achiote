import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';

const landing = () => fs.readFileSync('docs/landing/index.html', 'utf8');
const app = () => fs.readFileSync('docs/landing/app.html', 'utf8');
const appJs = () => fs.readFileSync('docs/landing/app.js', 'utf8');
const server = () => fs.readFileSync('src/http-server.ts', 'utf8');

describe('launch business hardening', () => {
  it('publishes trust, legal, safety, and support pages linked from public surfaces', () => {
    for (const page of ['privacy.html', 'terms.html', 'support.html', 'safety.html', 'ai-search.html', 'llms.txt']) {
      expect(fs.existsSync(`docs/landing/${page}`)).toBe(true);
    }

    const publicSurfaces = `${landing()}\n${app()}`;
    expect(publicSurfaces).toContain('/privacy');
    expect(publicSurfaces).toContain('/terms');
    expect(publicSurfaces).toContain('/support');
    expect(publicSurfaces).toContain('/safety');
    expect(publicSurfaces).toContain('/ai-search');
    expect(publicSurfaces).toContain('support@kyanitelabs.tech');
  });

  it('positions Achiote as food-memory forensics before technical MCP framing', () => {
    const page = landing();
    const appPage = app();

    expect(page).toContain('Remember the dish. Or the drink.');
    expect(page).toContain('food-memory forensics');
    expect(page).toContain('Memory Receipt');
    expect(page).toContain('one cheap taste test before a full recipe or drink');
    expect(page.indexOf('Remember the dish. Or the drink.')).toBeLessThan(page.indexOf('MCP'));
    expect(appPage).toContain('Food Memory Detective');
    expect(page).not.toContain('AI Food Memory Reconstruction | Source-Available MCP Server');
  });

  it('documents privacy controls, retention, deletion, and AI food-safety limits', () => {
    const privacy = fs.readFileSync('docs/landing/privacy.html', 'utf8');
    const safety = fs.readFileSync('docs/landing/safety.html', 'utf8');
    const support = fs.readFileSync('docs/landing/support.html', 'utf8');

    expect(privacy).toContain('Data deletion');
    expect(privacy).toContain('Food memories');
    expect(privacy).toContain('90 days');
    expect(safety).toContain('not medical advice');
    expect(safety).toContain('allergies');
    expect(support).toContain('Response target');
    expect(support).toContain('refund');
  });

  it('adds privacy-preserving telemetry and feedback hooks without storing prompt text', () => {
    expect(appJs()).toContain("trackEvent('ask_started'");
    expect(appJs()).toContain("trackEvent('ask_succeeded'");
    expect(appJs()).toContain("trackEvent('ask_failed'");
    expect(appJs()).toContain("trackEvent('onboarding_prompt_selected'");
    expect(appJs()).toContain("sendFeedback(");
    for (const eventName of [
      'feedback_closer',
      'feedback_wrong_region',
      'feedback_wrong_acid',
      'feedback_wrong_texture',
      'feedback_too_generic',
      'feedback_too_hard',
      'feedback_missed_name_correction',
    ]) {
      expect(appJs()).toContain(eventName);
      expect(server()).toContain(`'${eventName}'`);
    }
    expect(appJs()).not.toContain('feedback_helpful');
    expect(appJs()).not.toContain('feedback_generic');
    expect(server()).toContain("'receipt_downloaded'");
    expect(server()).toContain("'family_questions_copied'");
    expect(appJs()).toContain("navigator.sendBeacon('/events'");
    expect(appJs()).not.toContain("prompt_text");

    expect(server()).toContain('Forbidden origin');
    expect(server()).toContain('Telemetry rate limit exceeded');
    expect(server()).toContain("pathname === '/events'");
    expect(server()).toContain('allowedTelemetryEvents');
    expect(server()).toContain('allowedTelemetryProperties');
    expect(server()).toContain("'feedback_close'");
    expect(server()).toContain("'feedback_too_hard'");
    expect(server()).toContain("'feedback_missed_correction'");
    expect(server()).toContain('telemetryBreakdowns');
    expect(server()).toContain('telemetryCounters');
    expect(server()).toContain('qualitySignalReport');
    expect(server()).toContain('buildAskQualitySignal');
    expect(server()).toContain('recordQualitySignal');
    expect(server()).toContain('quality: qualitySignalReport');
    expect(server()).toContain("sendJson(res, 404, { error: 'Not found' })");
    expect(server()).not.toContain('event.payload');
  });

  it('gives first-time users a concrete memory prompt scaffold', () => {
    const page = app();
    const js = appJs();

    expect(page).toContain('Start with any three clues');
    expect(page).toContain('Who made it, or where you ate it');
    expect(page).toContain('What you are unsure about');
    expect(page).toContain('data-suggestion-category="family-region-texture"');
    expect(page).toContain('data-suggestion-category="sensory-soup"');
    expect(js).toContain('suggestionCategory');
    expect(js).toContain('source: text ?');
  });

  it('keeps the live tool trace readable for preview users', () => {
    const page = app();
    const js = appJs();

    expect(page).toContain('.trace-panel');
    expect(page).toContain('font-size: 1rem');
    expect(page).toContain('.trace-heading');
    expect(page).toContain('.trace-phase');
    expect(page).toContain('.trace-tool-name');
    expect(js).toContain('assistant-content');
    expect(js).toContain('phaseForStatus');
    expect(js).toContain('Reading memory');
    expect(js).toContain('Correcting likely name');
    expect(js).toContain('Researching');
    expect(js).toContain('Building first test');
    expect(js).toContain("item.className = `trace-item ${type}`");
    expect(js).toContain('Feels close');
    expect(js).toContain('Too hard to make');
    expect(js).toContain('Did not correct my wording');
    expect(js).not.toContain('font-size:12px');
    expect(js).not.toContain('font-size:11px');
  });

  it('lets users keep the memory receipt after a successful answer', () => {
    const page = app();
    const js = appJs();

    expect(page).toContain('.receipt-actions');
    expect(js).toContain("eventType === 'receipt'");
    expect(js).toContain('downloadMemoryReceipt');
    expect(js).toContain('copyFamilyQuestions');
    expect(js).toContain('Achiote Memory Receipt');
    expect(js).toContain('URL.createObjectURL');
    expect(js).not.toContain("localStorage.setItem('achiote-last-memory");
  });

  it('ships a viability transcript smoke for moat regressions', () => {
    const script = fs.readFileSync('scripts/viability-transcript-smoke.mjs', 'utf8');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

    expect(pkg.scripts['viability:smoke']).toBe('node scripts/viability-transcript-smoke.mjs');
    expect(script).toContain('My abuela made something sour and herby');
    expect(script).toContain('thing');
    expect(script).toContain('Memory Receipt');
    expect(script).toContain('event: receipt');
    expect(script).toContain('forbiddenPatterns');
  });

  it('ships a repeatable preview ask smoke for demo-quality regressions', () => {
    const previewSmoke = fs.readFileSync('scripts/preview-ask-smoke.mjs', 'utf8');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

    expect(pkg.scripts['preview:smoke']).toBe('node scripts/preview-ask-smoke.mjs');
    expect(previewSmoke).toContain('ACHIOTE_PREVIEW_URL');
    expect(previewSmoke).toContain('typo_carimanola');
    expect(previewSmoke).toContain('soundalike_chikki');
    expect(previewSmoke).toContain('explicit_minimum_cue_abroad');
    expect(previewSmoke).toContain('correct_mistakes_not_literal');
    expect(previewSmoke).toContain('buyExactDishPatterns');
    expect(previewSmoke).toContain('All preview /ask quality cases passed');
  });

  it('keeps preview ask smoke friendly to copied URLs and negated buy guidance', async () => {
    const requests: string[] = [];
    const safeText = [
      'carimañola carimanola yuca cassava meat beef savory first tiny minimum verification.',
      'Chikki peanut sugar jaggery caramel snap sticky brittle.',
      'Trinidadian bake and shark fish lime vinegar acid tang chile pepper hot heat right track.',
      'coconut sugar grainy crystal crystalline chewy Ohio local grocery pantry.',
      'Your pastelay spelling is likely pasteles; correct your pastelay mistake with achiote annatto sazón orange pork first-pass tiny check.',
      "Don't buy the exact chikki candy; make a local proxy instead.",
    ].join(' ');
    let responseText = safeText;
    const server = http.createServer((request, response) => {
      requests.push(request.url ?? '');
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end([
        'event: status',
        'data: {"stage":"model"}',
        '',
        'event: tool_call',
        'data: {"name":"collect_food_memory"}',
        '',
        'event: text',
        `data: ${JSON.stringify(responseText)}`,
        '',
        'event: done',
        'data: {}',
        '',
      ].join('\n'));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test server did not bind to a port');
      const runSmoke = () => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn(process.execPath, ['scripts/preview-ask-smoke.mjs'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ACHIOTE_PREVIEW_URL: `http://127.0.0.1:${address.port}/ask/`,
            ACHIOTE_PREVIEW_TIMEOUT_MS: '5000',
          },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      });

      const result = await runSmoke();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`Preview /ask smoke target: http://127.0.0.1:${address.port}/ask`);
      expect(result.stdout).toContain('All preview /ask quality cases passed');
      expect(requests).toHaveLength(5);
      expect(requests.every((url) => url === '/ask')).toBe(true);

      requests.length = 0;
      responseText = safeText.replace("Don't buy the exact chikki candy", 'Don\u2019t buy the exact chikki candy');
      const curlyApostropheResult = await runSmoke();
      expect(curlyApostropheResult.status, curlyApostropheResult.stderr).toBe(0);
      expect(curlyApostropheResult.stdout).toContain('All preview /ask quality cases passed');
      expect(requests).toHaveLength(5);
      expect(requests.every((url) => url === '/ask')).toBe(true);

      requests.length = 0;
      responseText = safeText.replace("Don't buy the exact chikki candy", 'why not buy the exact chikki candy');
      const rejectedResult = await runSmoke();
      expect(rejectedResult.status).toBe(1);
      expect(rejectedResult.stderr).toContain('preview /ask quality case(s) failed');
      expect(rejectedResult.stdout).toContain('buy (?:a|the)');
      expect(requests).toHaveLength(5);
      expect(requests.every((url) => url === '/ask')).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('keeps SEO and launch metadata current for trust pages', () => {
    const sitemap = fs.readFileSync('docs/landing/sitemap.xml', 'utf8');
    const robots = fs.readFileSync('docs/landing/robots.txt', 'utf8');
    const manifest = fs.readFileSync('docs/landing/manifest.json', 'utf8');
    const aiRunbook = fs.readFileSync('docs/AI_SEARCH_SUBMISSION_RUNBOOK.md', 'utf8');

    expect(landing()).toContain('application/ld+json');
    expect(landing()).toContain('ContactPoint');
    const jsonLdBlocks = [...landing().matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(jsonLdBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of jsonLdBlocks) {
      expect(() => JSON.parse(block[1] ?? '')).not.toThrow();
    }
    expect(sitemap).toContain('/privacy');
    expect(sitemap).toContain('/terms');
    expect(sitemap).toContain('/support');
    expect(sitemap).toContain('/safety');
    expect(sitemap).toContain('<lastmod>2026-04-25</lastmod>');
    expect(robots).toContain('Sitemap: https://achiote.kyanitelabs.tech/sitemap.xml');
    expect(robots).toContain('User-agent: PerplexityBot');
    expect(robots).toContain('User-agent: Perplexity-User');
    expect(manifest).toContain('Achiote');
    expect(aiRunbook).toContain('Google Search Console');
    expect(aiRunbook).toContain('Bing Webmaster Tools');
    expect(aiRunbook).toContain('IndexNow');
    expect(aiRunbook).toContain('ChatGPT');
    expect(aiRunbook).toContain('Claude');
    expect(aiRunbook).toContain('Gemini');
  });

  it('documents launch operations, monitoring, support, rollback, and deletion workflow', () => {
    const runbook = fs.readFileSync('docs/LAUNCH_RUNBOOK.md', 'utf8');
    const support = fs.readFileSync('docs/landing/support.html', 'utf8');
    const privacy = fs.readFileSync('docs/landing/privacy.html', 'utf8');
    const terms = fs.readFileSync('docs/landing/terms.html', 'utf8');

    expect(runbook).toContain('npm run check');
    expect(runbook).toContain('npm run preview:smoke');
    expect(runbook).toContain('ask_failed / ask_started');
    expect(runbook).toContain('feedback_close');
    expect(runbook).toContain('feedback_missed_correction');
    expect(runbook).toContain('checkout_started / pricing_viewed');
    expect(runbook).toContain('onboarding_prompt_selected');
    expect(runbook).toContain('support@kyanitelabs.tech');
    expect(runbook).toContain('90 days');
    expect(runbook).toContain('Rollback');
    expect(runbook).toContain('deletion/export/correction');
    expect(runbook).toContain('Do not expose raw event counters on a public route');
    expect(support).toContain('What happens next');
    expect(support).toContain('Data request checklist');
    expect(privacy).toContain('privacy-preserving event dimensions');
    expect(terms).toContain('Guided-memory subscriptions');
  });

  it('sells paid-launch guided memories publicly and keeps hosted MCP/API commercial', () => {
    const page = landing();
    const aiSearch = fs.readFileSync('docs/landing/ai-search.html', 'utf8');
    const llms = fs.readFileSync('docs/landing/llms.txt', 'utf8');
    const envExample = fs.readFileSync('.env.example', 'utf8');
    const setupScript = fs.readFileSync('scripts/setup-stripe-products.mjs', 'utf8');
    const httpServer = server();

    for (const copy of ['3 guided memories', '25 guided memories', '25 guided memories, no subscription', 'Family Archive Sprint', 'from $299/month', 'pilots from $1,500']) {
      expect(page).toContain(copy);
      expect(aiSearch).toContain(copy);
      expect(llms).toContain(copy);
    }

    for (const copy of ['25 guided memories per month', 'Personal annual', '25 guided memories, no subscription', '$49', '$149']) {
      expect(setupScript).toContain(copy);
    }

    expect(page).toContain('$9');
    expect(page).toContain('$59/year');
    expect(page).toContain('$49');
    expect(page).toContain('$39');
    expect(page).toContain('Hosted API and MCP access require a commercial license');
    expect(page).toContain('data-checkout-tier="personal"');
    expect(page).toContain('data-checkout-billing="annual"');
    expect(page).toContain('data-checkout-tier="memory-pack"');
    expect(page).toContain('data-checkout-tier="family-sprint"');
    expect(page).toContain('data-checkout-tier="family"');
    expect(httpServer).toContain("billing === 'annual'");
    expect(httpServer).toContain('isSubscriptionCheckoutTier(requestedTier)');
    expect(httpServer).toContain('Use personal or family.');
    expect(httpServer).toContain('billingDb.authenticateApiKey(rawBillingKey)');
    expect(httpServer).toContain('billingDb.getCustomerIdByKeyId(billingAuth.keyId)');
    expect(httpServer).not.toContain("mode === 'payment' ? 'personal'");
    expect(httpServer).not.toContain('customerId is required');
    expect(envExample).toContain('STRIPE_PERSONAL_ANNUAL_PRICE_ID');
    expect(envExample).toContain('STRIPE_MEMORY_PACK_PRICE_ID');
    expect(envExample).toContain('STRIPE_FAMILY_SPRINT_PRICE_ID');
    expect(envExample).toContain('STRIPE_CREDIT_PACK_PRICE_ID');

    for (const stale of [
      'Achiote Pro',
      'Get Pro',
      'Pro: $19/month',
      '50 MCP calls / month',
      '5,000 MCP calls / month',
      '100,000 MCP calls / month',
      'Unlimited web reconstructions',
      '1,000 extra calls',
      'hosted API free tier',
      'A hosted HTTP API is also available',
      '$19',
      '$9 for 25 extra guided memories',
    ]) {
      expect(page).not.toContain(stale);
      expect(setupScript).not.toContain(stale);
      expect(llms).not.toContain(stale);
    }
  });

  it('ships an invented evidence-bounded sample reconstruction artifact', () => {
    const sample = fs.readFileSync('docs/landing/sample-reconstruction-artifact.md', 'utf8');

    for (const heading of ['User Fragment', 'User Said', 'Researched Facts', 'Inferred Facts', 'Unknowns', 'Minimum Viable Nostalgia Cue']) {
      expect(sample).toContain(heading);
    }
    expect(sample).toContain('invented sample');
    expect(sample).toContain('The memory may belong near');
    expect(sample).toContain('the exact dish is not proven');
    expect(sample).not.toContain('pastelay');
    expect(sample).not.toContain('carimanolla');
  });
});
