#!/usr/bin/env node
/**
 * Production E2E probe: tests the live Achiote instance at achiote.kyanitelabs.tech
 * with full auth, billing, TLS, and local inference via Tailscale.
 *
 * Usage: node scripts/e2e-probe-production.mjs
 * Requires ACHIOTE_PROBE_KEY env var with a valid production API key.
 */

const PROD_URL = process.env.ACHIOTE_PROBE_URL || 'https://achiote.kyanitelabs.tech';
const API_KEY = process.env.ACHIOTE_PROBE_KEY;

if (!API_KEY) {
  console.error('Set ACHIOTE_PROBE_KEY env var with a valid production API key');
  process.exit(2);
}

console.log(`Target: ${PROD_URL}`);

const results = { passed: [], failed: [], warnings: [] };

function log(status, name, detail = '') {
  const entry = { name, detail, ts: new Date().toISOString() };
  if (status === 'pass') {
    results.passed.push(entry);
    console.log(`  PASS: ${name}`);
  } else if (status === 'fail') {
    results.failed.push(entry);
    console.log(`  FAIL: ${name} — ${detail}`);
  } else {
    results.warnings.push(entry);
    console.log(`  WARN: ${name} — ${detail}`);
  }
}

function authHeaders(extra = {}) {
  return { 'x-api-key': API_KEY, ...extra };
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, headers: res.headers, text, json, ok: res.ok };
}

async function main() {
  console.log(`\n=== Production E2E Probe — ${PROD_URL} ===\n`);

  // ── 1. Health & readiness ──────────────────────────────────────────────
  console.log('── Health & readiness ──');

  {
    const r = await fetchJSON(`${PROD_URL}/health`);
    if (r.status === 200 && r.json?.status === 'ok') {
      log('pass', 'GET /health');
      // Verify production config
      if (r.json.authEnabled === true) log('pass', 'Auth is enabled');
      else log('fail', 'Auth should be enabled', `authEnabled=${r.json.authEnabled}`);
      const readiness = r.json.readiness;
      if (readiness?.ready === true) {
        log('pass', 'All readiness checks pass');
      } else if (readiness?.status === 'degraded') {
        const failed = (readiness.checks || []).filter(c => !c.ok).map(c => c.name);
        log('warn', `Readiness degraded: ${failed.join(', ')}`);
      } else {
        log('fail', 'Readiness checks', JSON.stringify(readiness));
      }
    } else {
      log('fail', 'GET /health', `status=${r.status}`);
    }
  }

  // ── 2. Auth enforcement ────────────────────────────────────────────────
  console.log('\n── Auth enforcement ──');

  {
    // /ask without API key should be rejected
    const r = await fetchJSON(`${PROD_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' }),
    });
    if (r.status === 401) log('pass', '/ask rejects request without API key (401)');
    else log('fail', '/ask without key', `expected 401, got ${r.status}`);
  }

  {
    // /ask with invalid API key
    const r = await fetchJSON(`${PROD_URL}/ask`, {
      method: 'POST',
      headers: { 'x-api-key': 'ach_invalid_key_12345', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' }),
    });
    if (r.status === 401) log('pass', '/ask rejects invalid API key (401)');
    else log('fail', '/ask with bad key', `expected 401, got ${r.status}`);
  }

  {
    // /ask with Bearer token format
    const r = await fetchJSON(`${PROD_URL}/ask`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bearer format test' }),
    });
    if (r.status === 200 || r.status === 429) log('pass', `/ask accepts Bearer token format (${r.status})`);
    else log('fail', 'Bearer token format', `status=${r.status}`);
  }

  // ── 3. Static pages & security headers ─────────────────────────────────
  console.log('\n── Static pages & security headers ──');

  for (const path of ['/', '/privacy', '/terms', '/support', '/safety']) {
    const r = await fetchJSON(`${PROD_URL}${path}`);
    const csp = r.headers.get('content-security-policy');
    const hsts = r.headers.get('strict-transport-security');
    const xcto = r.headers.get('x-content-type-options');
    const issues = [];
    if (r.status !== 200) issues.push(`status=${r.status}`);
    if (!csp) issues.push('no CSP');
    if (!hsts) issues.push('no HSTS');
    if (!xcto) issues.push('no X-Content-Type-Options');
    if (issues.length === 0) log('pass', `GET ${path} + security headers (CSP, HSTS, nosniff)`);
    else log('fail', `GET ${path}`, issues.join(', '));
  }

  {
    const r = await fetchJSON(`${PROD_URL}/llms.txt`);
    if (r.status === 200 && r.headers.get('content-type')?.includes('text/plain')) log('pass', 'GET /llms.txt');
    else log('fail', 'GET /llms.txt', `status=${r.status}`);
  }

  // ── 4. Real /ask inference via local model ──────────────────────────────
  console.log('\n── Real /ask inference (local qwen3.6-35b-a3b via Tailscale) ──');

  {
    console.log('  → Simple food memory...');
    const r = await fetchJSON(`${PROD_URL}/ask`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: 'My grandmother used to make achiote paste from scratch in Yucatan' }),
    });
    if (r.status === 200) {
      log('pass', '/ask returns 200 with auth');
      if (r.text.length > 100) log('pass', `Response has substance (${r.text.length} chars)`);
      else log('warn', '/ask response seems short', `${r.text.length} chars`);
    } else {
      log('fail', '/ask simple food memory', `status=${r.status} body=${r.text?.slice(0, 500)}`);
    }
  }

  {
    console.log('  → Unicode and special characters...');
    const r = await fetchJSON(`${PROD_URL}/ask`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: '配達 料理 🍜 pupusas from El Salvador & "quotes" \'single\'' }),
    });
    if (r.status === 200) log('pass', 'Handles Unicode/HTML/special chars safely');
    else if (r.status === 429) log('pass', 'Unicode message rate-limited (clean rejection)');
    else log('fail', 'Unicode message', `status=${r.status}: ${r.text?.slice(0, 200)}`);
  }

  {
    console.log('  → Long message...');
    const longMsg = 'I remember a dish. '.repeat(500);
    const r = await fetchJSON(`${PROD_URL}/ask`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: longMsg }),
    });
    if (r.status === 200) log('pass', 'Handles long message (200)');
    else if (r.status === 429) log('pass', 'Long message rate-limited (clean rejection)');
    else if (r.status >= 400 && r.status < 500) log('pass', `Handles long message (${r.status} — clean rejection)`);
    else log('fail', 'Long message', `status=${r.status}: ${r.text?.slice(0, 300)}`);
  }

  // ── 5. Input validation on /ask ────────────────────────────────────────
  console.log('\n── /ask input validation ──');

  {
    const r = await fetchJSON(`${PROD_URL}/ask`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'text/plain' }),
      body: 'not json',
    });
    if (r.status === 415) log('pass', 'Rejects non-JSON content-type (415)');
    else log('fail', 'Non-JSON content-type', `expected 415, got ${r.status}`);
  }

  {
    const r = await fetchJSON(`${PROD_URL}/ask`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: 'not valid json{{{',
    });
    if (r.status === 400) log('pass', 'Rejects malformed JSON (400)');
    else log('fail', 'Malformed JSON', `expected 400, got ${r.status}`);
  }

  {
    const r = await fetchJSON(`${PROD_URL}/ask`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({}),
    });
    if (r.status === 400) log('pass', 'Rejects empty body — no message (400)');
    else log('fail', 'Empty body', `expected 400, got ${r.status}`);
  }

  {
    const r = await fetchJSON(`${PROD_URL}/ask`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: '' }),
    });
    if (r.status === 400) log('pass', 'Rejects empty message string (400)');
    else log('fail', 'Empty message', `expected 400, got ${r.status}`);
  }

  {
    const r = await fetchJSON(`${PROD_URL}/ask`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: '   ' }),
    });
    if (r.status === 400) log('pass', 'Rejects whitespace-only message (400)');
    else log('fail', 'Whitespace message', `expected 400, got ${r.status}`);
  }

  // ── 6. Voice endpoints ─────────────────────────────────────────────────
  console.log('\n── Voice endpoints ──');

  {
    const r = await fetchJSON(`${PROD_URL}/voice/status`);
    if (r.status === 200 && r.json?.stt && r.json?.tts) log('pass', 'GET /voice/status');
    else log('fail', '/voice/status', `status=${r.status} body=${r.text?.slice(0, 200)}`);
  }

  {
    const r = await fetchJSON(`${PROD_URL}/voice/transcribe`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ audioBase64: Buffer.from('tiny').toString('base64'), mediaType: 'audio/wav' }),
    });
    if (r.status === 503) log('pass', 'POST /voice/transcribe returns 503 (STT not ready)');
    else log('fail', '/voice/transcribe', `expected 503, got ${r.status}`);
  }

  {
    const r = await fetchJSON(`${PROD_URL}/voice/synthesize`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text: 'hello', language: 'en' }),
    });
    if (r.status === 503) log('pass', 'POST /voice/synthesize returns 503 (TTS not ready)');
    else log('fail', '/voice/synthesize', `expected 503, got ${r.status}`);
  }

  // ── 7. MCP endpoint ────────────────────────────────────────────────────
  console.log('\n── MCP endpoint ──');

  {
    const r = await fetchJSON(`${PROD_URL}/mcp`);
    if (r.status >= 400) log('pass', `GET /mcp without session returns ${r.status}`);
    else log('fail', 'GET /mcp', `expected 4xx, got ${r.status}`);
  }

  {
    const r = await fetchJSON(`${PROD_URL}/mcp`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { capabilities: {} }, id: 1 }),
    });
    if (r.status === 200) log('pass', 'POST /mcp initialize with auth returns 200');
    else log('warn', 'POST /mcp initialize', `status ${r.status}: ${r.text?.slice(0, 200)}`);
  }

  // ── 8. Billing endpoints ───────────────────────────────────────────────
  console.log('\n── Billing endpoints ──');

  {
    const r = await fetchJSON(`${PROD_URL}/billing/session`);
    if (r.status === 503) log('pass', '/billing/session returns 503 (no session ID)');
    else if (r.status === 400) log('pass', '/billing/session returns 400 (missing session param)');
    else log('warn', '/billing/session', `status=${r.status}: ${r.text?.slice(0, 200)}`);
  }

  {
    const r = await fetchJSON(`${PROD_URL}/billing/checkout`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tier: 'personal' }),
    });
    // With Stripe configured this should try to create a checkout session
    if (r.status === 200) log('pass', '/billing/checkout creates session');
    else if (r.status === 400) log('pass', `/billing/checkout validates input (${r.status})`);
    else log('warn', '/billing/checkout', `status=${r.status}: ${r.text?.slice(0, 300)}`);
  }

  // ── 9. Telemetry ───────────────────────────────────────────────────────
  console.log('\n── Telemetry ──');

  {
    const r = await fetchJSON(`${PROD_URL}/events`, {
      method: 'POST',
      headers: { Origin: PROD_URL, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'ask_started', properties: { route: '/app' } }),
    });
    if (r.status === 202) log('pass', 'Accepts valid telemetry event (202)');
    else log('fail', 'Valid telemetry', `expected 202, got ${r.status}`);
  }

  {
    const r = await fetchJSON(`${PROD_URL}/events`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'ask_started' }),
    });
    if (r.status === 403) log('pass', 'Rejects cross-origin telemetry (403)');
    else log('fail', 'Cross-origin telemetry', `expected 403, got ${r.status}`);
  }

  // ── 10. Error handling ─────────────────────────────────────────────────
  console.log('\n── Error handling ──');

  {
    const r = await fetchJSON(`${PROD_URL}/nonexistent-path-xyz`);
    if (r.status === 404 && r.json?.error) log('pass', '404 with JSON error for unknown path');
    else log('fail', 'Unknown path', `status=${r.status}`);
  }

  {
    const r = await fetchJSON(`${PROD_URL}/health`, { method: 'POST' });
    if (r.status >= 400 && r.status < 500) log('pass', `POST /health returns ${r.status} (not crash)`);
    else log('fail', 'POST /health', `unexpected status ${r.status}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════');
  console.log(`  PASSED:   ${results.passed.length}`);
  console.log(`  FAILED:   ${results.failed.length}`);
  console.log(`  WARNINGS: ${results.warnings.length}`);
  console.log('════════════════════════════════════════\n');

  if (results.failed.length > 0) {
    console.log('Failures:');
    for (const f of results.failed) console.log(`  ❌ ${f.name}: ${f.detail}`);
    console.log();
  }
  if (results.warnings.length > 0) {
    console.log('Warnings:');
    for (const w of results.warnings) console.log(`  ⚠️  ${w.name}: ${w.detail}`);
    console.log();
  }

  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});
