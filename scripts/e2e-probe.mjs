#!/usr/bin/env node
/**
 * End-to-end probe: starts the real HTTP server and exercises every endpoint
 * against the configured inference provider (GLM z.ai via Anthropic-compatible API).
 *
 * Finds: errors, edge cases, silent failures, swallowed errors.
 * Outputs structured results to stdout.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to allocate an ephemeral port')));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(port);
      });
    });
  });
}

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

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, headers: res.headers, text, json, ok: res.ok };
}

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`\n=== E2E Probe — starting server on :${port} ===\n`);

  const server = spawn('node', [resolve(ROOT, 'dist/http-server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      ACHIOTE_AUTH_ENABLED: 'false',
      ACHIOTE_ALLOW_ANON_ASK: 'true',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stderr = [];
  server.stderr.on('data', (d) => stderr.push(d.toString()));

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 15000);
    server.stdout.on('data', (d) => {
      if (d.toString().includes(`localhost:${port}`)) { clearTimeout(timeout); resolve(); }
    });
    server.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });

  try {
    // ── 1. Health & static endpoints ─────────────────────────────────────────
    console.log('\n── Health & static endpoints ──');

    {
      const r = await fetchJSON(`${baseUrl}/health`);
      if (r.status === 200 && r.json?.status === 'ok') log('pass', 'GET /health');
      else log('fail', 'GET /health', `status=${r.status} body=${r.text?.slice(0, 200)}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/`);
      if (r.status === 200 && r.text?.includes('doctype')) log('pass', 'GET / serves HTML');
      else log('fail', 'GET /', `status=${r.status}`);
    }

    {
      for (const path of ['/privacy', '/terms', '/support', '/safety']) {
        const r = await fetchJSON(`${baseUrl}${path}`);
        const csp = r.headers.get('content-security-policy');
        const hsts = r.headers.get('strict-transport-security');
        if (r.status === 200 && csp && hsts) log('pass', `GET ${path} + security headers`);
        else log('fail', `GET ${path}`, `status=${r.status} csp=${!!csp} hsts=${!!hsts}`);
      }
    }

    {
      const r = await fetchJSON(`${baseUrl}/llms.txt`);
      if (r.status === 200 && r.headers.get('content-type')?.includes('text/plain')) log('pass', 'GET /llms.txt');
      else log('fail', 'GET /llms.txt', `status=${r.status}`);
    }

    // ── 2. Voice endpoints ──────────────────────────────────────────────────
    console.log('\n── Voice endpoints ──');

    {
      const r = await fetchJSON(`${baseUrl}/voice/status`);
      if (r.status === 200 && r.json?.stt && r.json?.tts) log('pass', 'GET /voice/status');
      else log('fail', 'GET /voice/status', `status=${r.status} body=${r.text?.slice(0, 200)}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: Buffer.from('tiny').toString('base64'), mediaType: 'audio/wav' }),
      });
      // Should be 503 (STT disabled) not 500 or crash
      if (r.status === 503) log('pass', 'POST /voice/transcribe returns 503 when STT disabled');
      else log('fail', 'POST /voice/transcribe', `expected 503, got ${r.status}: ${r.text?.slice(0, 200)}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello', language: 'en' }),
      });
      if (r.status === 503) log('pass', 'POST /voice/synthesize returns 503 when TTS disabled');
      else log('fail', 'POST /voice/synthesize', `expected 503, got ${r.status}: ${r.text?.slice(0, 200)}`);
    }

    // ── 3. Edge-case inputs on /voice ───────────────────────────────────────
    console.log('\n── Voice edge cases ──');

    {
      const r = await fetchJSON(`${baseUrl}/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: 'not-valid-base64!!!', mediaType: 'audio/wav' }),
      });
      if (r.status === 400) log('pass', 'Rejects invalid base64 on /voice/transcribe');
      else log('fail', 'Reject invalid base64', `expected 400, got ${r.status}: ${r.text?.slice(0, 200)}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaType: 'audio/wav' }),
      });
      if (r.status === 400) log('pass', 'Rejects missing audioBase64');
      else log('fail', 'Missing audioBase64', `expected 400, got ${r.status}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: Buffer.from('x').toString('base64'), mediaType: 'video/mp4' }),
      });
      if (r.status === 400 && r.json?.error?.includes('Unsupported')) log('pass', 'Rejects unsupported media type');
      else log('fail', 'Unsupported media type', `expected 400 w/ Unsupported, got ${r.status}: ${r.text?.slice(0, 200)}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (r.status === 400) log('pass', 'Rejects empty /voice/synthesize body');
      else log('fail', 'Empty synthesize body', `expected 400, got ${r.status}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'a'.repeat(10000) }),
      });
      if (r.status === 400) log('pass', 'Rejects oversized text on /voice/synthesize');
      else log('fail', 'Oversized synthesize text', `expected 400, got ${r.status}`);
    }

    // ── 4. Telemetry ────────────────────────────────────────────────────────
    console.log('\n── Telemetry ──');

    {
      const r = await fetchJSON(`${baseUrl}/events`, {
        method: 'POST',
        headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'ask_started', properties: { route: '/app' } }),
      });
      if (r.status === 202) log('pass', 'Accepts valid telemetry event');
      else log('fail', 'Valid telemetry', `expected 202, got ${r.status}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/events`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'ask_started' }),
      });
      if (r.status === 403) log('pass', 'Rejects cross-origin telemetry');
      else log('fail', 'Cross-origin telemetry', `expected 403, got ${r.status}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/events`, {
        method: 'POST',
        headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'prompt_text' }),
      });
      if (r.status === 400) log('pass', 'Rejects disallowed event name');
      else log('fail', 'Disallowed event', `expected 400, got ${r.status}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/events`);
      if (r.status === 404) log('pass', 'GET /events returns 404 without token');
      else log('fail', 'GET /events public read', `expected 404, got ${r.status}`);
    }

    // ── 5. Unknown paths & method errors ────────────────────────────────────
    console.log('\n── Error handling ──');

    {
      const r = await fetchJSON(`${baseUrl}/nonexistent-xyz`);
      if (r.status === 404 && r.json?.error) log('pass', '404 for unknown path with JSON error');
      else log('fail', 'Unknown path 404', `status=${r.status}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/health`, { method: 'POST' });
      // Should return 404 or 405 — not crash
      if (r.status >= 400 && r.status < 500) log('pass', `POST /health returns ${r.status} (not crash)`);
      else log('fail', 'POST /health', `unexpected status ${r.status}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json',
      });
      if (r.status === 415) log('pass', 'Rejects non-JSON content-type on /ask');
      else log('fail', 'Non-JSON /ask', `expected 415, got ${r.status}: ${r.text?.slice(0, 200)}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{{{',
      });
      if (r.status === 400) log('pass', 'Rejects malformed JSON on /ask');
      else log('fail', 'Malformed JSON /ask', `expected 400, got ${r.status}: ${r.text?.slice(0, 200)}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (r.status === 400) log('pass', 'Rejects empty /ask body (no message)');
      else log('fail', 'Empty /ask body', `expected 400, got ${r.status}: ${r.text?.slice(0, 200)}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '' }),
      });
      if (r.status === 400) log('pass', 'Rejects empty message string');
      else log('fail', 'Empty message string', `expected 400, got ${r.status}`);
    }

    // ── 6. MCP endpoint ────────────────────────────────────────────────────
    console.log('\n── MCP endpoint ──');

    {
      const r = await fetchJSON(`${baseUrl}/mcp`);
      if (r.status >= 400) log('pass', `GET /mcp without session returns ${r.status}`);
      else log('fail', 'GET /mcp', `expected 4xx, got ${r.status}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: {}, id: 1 }),
      });
      if (r.status >= 400) log('pass', `POST /mcp without auth returns ${r.status}`);
      else log('warn', 'POST /mcp without auth', `status ${r.status} — auth may be disabled`);
    }

    // ── 7. Real LLM inference via /ask ─────────────────────────────────────
    console.log('\n── Real LLM inference (GLM z.ai) ──');

    {
      console.log('  → Sending simple food memory to /ask...');
      const r = await fetchJSON(`${baseUrl}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'My grandmother used to make achiote paste from scratch in Yucatan' }),
      });
      if (r.status === 200) {
        log('pass', '/ask simple food memory returns 200');
        // Check if response has actual content
        const text = r.text || '';
        if (text.length > 100) log('pass', `/ask response has substance (${text.length} chars)`);
        else log('warn', '/ask response seems short', `${text.length} chars`);
      } else {
        log('fail', '/ask simple food memory', `status=${r.status} body=${r.text?.slice(0, 500)}`);
      }
    }

    {
      console.log('  → Sending empty-ish message...');
      const r = await fetchJSON(`${baseUrl}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '   ' }),
      });
      if (r.status === 400) log('pass', 'Rejects whitespace-only message');
      else log('fail', 'Whitespace message', `expected 400, got ${r.status}: ${r.text?.slice(0, 200)}`);
    }

    {
      console.log('  → Sending very long message...');
      const longMsg = 'I remember a dish. '.repeat(500);
      const r = await fetchJSON(`${baseUrl}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: longMsg }),
      });
      // Should either succeed or give a clear error, not crash
      if (r.status === 200) log('pass', 'Handles long message (200)');
      else if (r.status >= 400 && r.status < 500) log('pass', `Handles long message (${r.status} — clean rejection)`);
      else log('fail', 'Long message', `status=${r.status}: ${r.text?.slice(0, 300)}`);
    }

    {
      console.log('  → Sending message with special characters...');
      const r = await fetchJSON(`${baseUrl}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '配達 料理 🍜 <script>alert("xss")</script> & "quotes" \'single\'' }),
      });
      if (r.status === 200) log('pass', 'Handles Unicode/HTML/message injection safely');
      else log('fail', 'Unicode/HTML message', `status=${r.status}: ${r.text?.slice(0, 200)}`);
    }

    {
      console.log('  → Sending extra fields (should be ignored)...');
      const r = await fetchJSON(`${baseUrl}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'pupusas from El Salvador', extraField: 'ignored', another: 123 }),
      });
      if (r.status === 200) log('pass', 'Ignores extra JSON fields');
      else if (r.status === 429) log('pass', 'Ignores extra JSON fields (rate-limited, not crash)');
      else log('fail', 'Extra JSON fields', `status=${r.status}: ${r.text?.slice(0, 200)}`);
    }

    // ── 8. Billing endpoints (without Stripe configured) ─────────────────────
    console.log('\n── Billing endpoints (Stripe not configured) ──');

    {
      const r = await fetchJSON(`${baseUrl}/billing/session`);
      if (r.status === 503) log('pass', '/billing/session returns 503 when billing disabled');
      else log('fail', '/billing/session without billing', `expected 503, got ${r.status}`);
    }

    {
      const r = await fetchJSON(`${baseUrl}/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'personal' }),
      });
      if (r.status === 503) log('pass', '/billing/checkout returns 503 when billing disabled');
      else log('fail', '/billing/checkout without billing', `expected 503, got ${r.status}`);
    }

    // ── Summary ─────────────────────────────────────────────────────────────
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

    // Check server stderr for uncaught errors
    const stderrText = stderr.join('');
    const errorLines = stderrText.split('\n').filter(l => l.includes('Error') || l.includes('error') || l.includes('unhandled'));
    if (errorLines.length > 0) {
      console.log('Server stderr errors:');
      for (const line of errorLines.slice(0, 20)) console.log(`  ${line.trim()}`);
    }

    process.exit(results.failed.length > 0 ? 1 : 0);
  } finally {
    server.kill('SIGINT');
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});
