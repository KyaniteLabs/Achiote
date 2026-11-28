import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

// 2026-11-07 audit, ledger row 1: on /app the live progress trace printed raw tool ids
// ("Calling build_reconstruction_dossier", "Finished build_reconstruction_dossier"), and the
// Memory Receipt printed its raw status token in `.r-meta`, whose CSS uppercases it to
// FIRST_TEST_READY. A provider can even invent a tool name; that name was printed verbatim.
//
// The label tables and their fallbacks are behaviour-tested in product-app.test.ts. These checks
// pin the wiring, because a correct helper that a page never loads, or a line that still
// concatenates the raw id, brings the defect straight back:
//   - each page loads product-app.js before the script that calls it (defer keeps order), and
//   - no page script falls back to printing the raw id or status token.
//
// The browser-level proof (real Chrome, before/after on a real /ask turn) lives on repair card
// t_a6df6b8a. These checks keep the fix in CI, where no browser runs.

const appHtml = () => fs.readFileSync('docs/landing/app.html', 'utf8');
const receiptHtml = () => fs.readFileSync('docs/landing/receipt.html', 'utf8');
const researchAppJs = () => fs.readFileSync('docs/landing/research-app.js', 'utf8');
const receiptJs = () => fs.readFileSync('docs/landing/receipt.js', 'utf8');

type ScriptTag = { src: string; deferred: boolean };

/** External <script src> tags in document order, with whether they carry `defer`. */
function externalScripts(html: string): ScriptTag[] {
  return [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g)].map((match) => ({
    src: match[2]!,
    deferred: /\bdefer\b/.test(`${match[1]} ${match[3]}`),
  }));
}

describe('landing pages: internal ids never render as product copy', () => {
  it.each([
    ['app.html', 'research-app.js', appHtml],
    ['receipt.html', 'receipt.js', receiptHtml],
  ] as const)('%s loads product-app.js before %s, both deferred so execution follows document order', (_page, user, read) => {
    const scripts = externalScripts(read());
    const helper = scripts.findIndex((script) => /(?:^|\/)product-app\.js/.test(script.src));
    const consumer = scripts.findIndex((script) => script.src.includes(user));
    expect(helper).toBeGreaterThan(-1);
    expect(consumer).toBeGreaterThan(helper);
    expect(scripts[helper]!.deferred).toBe(true);
    expect(scripts[consumer]!.deferred).toBe(true);
  });

  it('research-app.js builds tool-trace lines and the receipt status line only from the label helpers', () => {
    const js = researchAppJs();

    expect(js).toMatch(/label = toolTraceLine\(type, d\.name\);/);
    expect(js).toMatch(/esc\(receiptStatusLabel\(r\.status\) \|\| 'Generated from your memory'\)/);

    // The raw concatenations that caused the defect must not come back.
    expect(js).not.toMatch(/'Calling '|'Finished '/);
    expect(js).not.toMatch(/String\(r\.status\)|escapeHtml\(r\.status|esc\(r\.status\)/);

    // Without the helper script the fallback is still generic words: no branch returns the id.
    expect(js).toMatch(/return type === 'tool_result' \? 'Step finished' : 'Working';/);
    const fallbacks = js.match(/\btoolTraceLine\(type, name\) \{[\s\S]*?\n  \}/);
    expect(fallbacks?.[0]).toBeDefined();
    expect(fallbacks?.[0]).not.toMatch(/\breturn name\b|\+ name/);
  });

  it('receipt.js shows a status label and never the raw token', () => {
    const js = receiptJs();

    expect(js).toContain('receiptStatusLabel(receipt.status)');
    expect(js).not.toMatch(/escapeHtml\(receipt\.status\b/);
    expect(js).not.toMatch(/receipt\.status \|\| 'unknown'/);
    expect(js).toContain("|| 'Not recorded'");
  });

  it('passes the tool id to the helper and nowhere else', () => {
    const js = researchAppJs();

    // `d.name` is the only door a tool id has into this file. It may appear exactly once, as
    // the helper's argument, so no template can concatenate it into displayed text.
    expect([...js.matchAll(/\bd\.name\b/g)]).toHaveLength(1);
    expect(js).toMatch(/toolTraceLine\(type, d\.name\)/);

    // Same rule for the status token on the share page: one use, as the helper's argument.
    expect([...receiptJs().matchAll(/\breceipt\.status\b/g)]).toHaveLength(1);
    expect(receiptJs()).toMatch(/receiptStatusLabel\(receipt\.status\)/);
  });
});
