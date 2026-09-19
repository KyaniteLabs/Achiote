#!/usr/bin/env node
// Verify every DOI in src/data/food-science-references.json resolves against Crossref.
//
// This is the gate that keeps the food-science reference DB honest: the data moat is
// only defensible if every citation is real. Crossref (api.crossref.org/works/{doi})
// is the source of truth — a DOI that returns a record with a title is real; a 404 is
// a fabricated or mistyped DOI and must never ship.
//
// Network-dependent by design, so (like validate:citations) it is NOT wired into the
// CI gate (check:compat). Run it on demand when adding or editing references:
//   node scripts/verify-dois.mjs           # report only
//   node scripts/verify-dois.mjs --fail    # exit 1 if any DOI fails (use before PR)
//   node scripts/verify-dois.mjs --no-cache # ignore the cache, re-check every DOI
//
// See docs/sop/food-science-db-expansion.md for the full expansion SOP.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REF_PATH = 'src/data/food-science-references.json';
const CACHE_PATH = 'artifacts/doi-verification-cache.json';
const CROSSREF = 'https://api.crossref.org/works/';
const UA = 'AchioteDOIVerify/1.0 (mailto:info@kyanitelabs.tech)';
const DELAY_MS = 200; // be polite to Crossref

const noCache = process.argv.includes('--no-cache');
const failOnError = process.argv.includes('--fail');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function loadCache() {
  if (noCache) return {};
  try {
    return readJson(CACHE_PATH);
  } catch {
    return {};
  }
}

function saveCache(cache) {
  const abs = path.join(root, CACHE_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(cache, null, 2) + '\n');
}

// Collect every DOI with the mechanism + source it belongs to.
function collectDois(data) {
  const out = [];
  for (const [mechanism, record] of Object.entries(data.mechanisms ?? {})) {
    for (const source of record.sources ?? []) {
      if (source.doi) out.push({ mechanism, id: source.id, doi: String(source.doi).trim() });
    }
  }
  return out;
}

async function checkDoi(doi) {
  try {
    const res = await fetch(CROSSREF + encodeURIComponent(doi), { headers: { 'User-Agent': UA } });
    if (res.status === 404) return { ok: false, reason: 'not found in Crossref (404)' };
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const body = await res.json();
    const title = body?.message?.title?.[0];
    if (!title) return { ok: false, reason: 'resolved but no title' };
    return { ok: true, title };
  } catch (err) {
    return { ok: false, reason: `request failed: ${err.message}` };
  }
}

async function main() {
  const data = readJson(REF_PATH);
  const entries = collectDois(data);
  const cache = loadCache();

  // Duplicate-DOI detection (a duplicate usually means a copy-paste error).
  const seen = new Map();
  const duplicates = [];
  for (const e of entries) {
    if (seen.has(e.doi)) duplicates.push({ doi: e.doi, a: seen.get(e.doi), b: `${e.mechanism}/${e.id}` });
    else seen.set(e.doi, `${e.mechanism}/${e.id}`);
  }

  const failures = [];
  let verified = 0;
  let fromCache = 0;

  for (const e of entries) {
    let result = cache[e.doi];
    if (result && result.ok) {
      fromCache++;
    } else {
      result = await checkDoi(e.doi);
      cache[e.doi] = result;
      await sleep(DELAY_MS);
    }
    if (result.ok) verified++;
    else failures.push({ ...e, reason: result.reason });
  }

  saveCache(cache);

  console.log(`DOI verification — ${REF_PATH}`);
  console.log(`  mechanisms:   ${Object.keys(data.mechanisms ?? {}).length}`);
  console.log(`  unique DOIs:  ${seen.size}  (total source rows: ${entries.length})`);
  console.log(`  verified:     ${verified}/${entries.length}  (${fromCache} from cache)`);
  console.log(`  duplicates:   ${duplicates.length}`);
  for (const d of duplicates) console.log(`    ! ${d.doi} used by ${d.a} and ${d.b}`);
  console.log(`  failures:     ${failures.length}`);
  for (const f of failures) console.log(`    ✗ ${f.mechanism}/${f.id}: ${f.doi} — ${f.reason}`);

  const problems = failures.length + duplicates.length;
  if (problems === 0) console.log('  all DOIs resolve, no duplicates ✓');
  if (failOnError && problems > 0) process.exitCode = 1;
}

main();
