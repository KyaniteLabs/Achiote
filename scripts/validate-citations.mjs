#!/usr/bin/env node
/**
 * Validates DOI citations in docs/landing/index.html against Crossref metadata.
 *
 * Checks:
 *   - DOI does not return a hard 404 via doi.org
 *   - Title matches Crossref record (fuzzy ≥ 75%)
 *   - Year matches Crossref record
 *   - First author surname appears in citation
 *
 * Usage:
 *   node scripts/validate-citations.mjs
 *
 * Exit codes:
 *   0 = all citations verified
 *   1 = one or more citations failed
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANDING_PATH = join(__dirname, "..", "docs", "landing", "index.html");

/* ── helpers ─────────────────────────────────────────────────────────── */

function levenshtein(a, b) {
  const m = Array.from({ length: b.length + 1 }, () =>
    Array(a.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) m[0][i] = i;
  for (let j = 0; j <= b.length; j++) m[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[j][i] = Math.min(m[j][i - 1] + 1, m[j - 1][i] + 1, m[j - 1][i - 1] + cost);
    }
  }
  return m[b.length][a.length];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return (maxLen - levenshtein(a.toLowerCase(), b.toLowerCase())) / maxLen;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCrossrefWork(doi) {
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);
  let lastStatus = 0;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await sleep(500 * attempt);
    }

    const res = await fetch(`https://api.crossref.org/works/${doi}`, {
      headers: {
        "User-Agent": "Achiote-CitationValidator/1.0 (mailto:hello@achiote.dev)",
        Accept: "application/json",
      },
    });
    lastStatus = res.status;
    if (res.ok) return res.json();
    if (!retryableStatuses.has(res.status)) {
      throw new Error(`Crossref API returned ${res.status}`);
    }
  }

  throw new Error(`Crossref API returned ${lastStatus} after retries`);
}

/* ── extraction ──────────────────────────────────────────────────────── */

function extractCitations(html) {
  const section = html.match(/<div class="sources[^"]*">[\s\S]*?<\/ol>[\s\S]*?<\/div>/);
  if (!section) {
    console.error("❌ Could not find .sources section in landing page");
    process.exit(1);
  }

  const citations = [];
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(section[0])) !== null) {
    const raw = m[1].replace(/\s+/g, " ");
    const doiMatch = raw.match(/doi\.org\/(10\.[^"\s<>]+)/);
    if (!doiMatch) continue;

    const doi = doiMatch[1];
    const titleMatch = raw.match(/&ldquo;(.*?)&rdquo;/);
    const title = titleMatch ? titleMatch[1] : "";
    const authorMatch = raw.match(/^\s*([^&(]+?)\s*\(/);
    const authors = authorMatch ? authorMatch[1].trim() : "";
    const yearMatch = raw.match(/\((\d{4})\)/);
    const year = yearMatch ? yearMatch[1] : "";

    citations.push({ doi, title, authors, year, raw: raw.trim() });
  }
  return citations;
}

/* ── validation ──────────────────────────────────────────────────────── */

async function validateDOI(citation) {
  const errors = [];

  // 1. Resolve DOI (secondary sanity check; Crossref is the source of truth)
  try {
    const res = await fetch(`https://doi.org/${citation.doi}`, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Achiote-CitationValidator/1.0 (mailto:hello@achiote.dev)",
        Accept: "text/html",
      },
    });
    if (res.status === 404) {
      errors.push(`DOI does not resolve (HTTP 404)`);
    } else if (!res.ok && res.status !== 301 && res.status !== 302) {
      // 403/429 usually means publisher bot protection, not a bad DOI.
      // We warn but do not fail here; Crossref is the authoritative check.
      console.log(`   ⚠️  DOI resolution returned HTTP ${res.status} (likely bot protection; relying on Crossref)`);
    }
  } catch (e) {
    // Network failures here usually come from publisher/CDN/TLS bot protection.
    // Crossref metadata below remains the authoritative citation check.
    console.log(`   ⚠️  DOI resolution failed (${e.message}); relying on Crossref`);
  }

  // 2. Crossref metadata
  try {
    const { message: work } = await fetchCrossrefWork(citation.doi);

    const crossrefTitle = work.title?.[0] ?? "";
    const crossrefYear =
      work["published-print"]?.["date-parts"]?.[0]?.[0] ??
      work["published-online"]?.["date-parts"]?.[0]?.[0] ??
      work.created?.["date-parts"]?.[0]?.[0] ??
      "";
    const firstAuthor = work.author?.[0]?.family ?? "";

    // Title fuzzy match
    const sim = similarity(citation.title, crossrefTitle);
    if (sim < 0.75) {
      errors.push(
        `Title mismatch (${(sim * 100).toFixed(1)}% similar)\n` +
        `  Citation: "${citation.title}"\n` +
        `  Crossref: "${crossrefTitle}"`
      );
    }

    // Year match
    if (citation.year && String(crossrefYear) !== citation.year) {
      errors.push(
        `Year mismatch: citation says ${citation.year}, Crossref says ${crossrefYear}`
      );
    }

    // First-author sanity check
    if (firstAuthor && citation.authors) {
      const authLower = citation.authors.toLowerCase();
      const firstLower = firstAuthor.toLowerCase();
      const isEtAl = authLower.includes("et al");
      const containsFirst = authLower.includes(firstLower);
      const firstContainsAny = firstLower.includes(authLower.split(/\s+/)?.[0] ?? "");
      if (!containsFirst && !firstContainsAny && !isEtAl) {
        errors.push(
          `First author mismatch: Crossref says "${firstAuthor}", citation says "${citation.authors}"`
        );
      }
    }
  } catch (e) {
    errors.push(`Crossref lookup failed: ${e.message}`);
  }

  return errors;
}

/* ── main ────────────────────────────────────────────────────────────── */

async function main() {
  console.log("🔍 Validating citations in docs/landing/index.html...\n");

  const html = readFileSync(LANDING_PATH, "utf-8");
  const citations = extractCitations(html);

  if (citations.length === 0) {
    console.error("❌ No DOI citations found in landing page sources");
    process.exit(1);
  }

  let failures = 0;

  for (const c of citations) {
    const errors = await validateDOI(c);
    if (errors.length === 0) {
      console.log(`✅ ${c.doi}`);
    } else {
      failures++;
      console.log(`❌ ${c.doi}`);
      for (const err of errors) {
        console.log(`   ${err}`);
      }
    }
  }

  console.log("");
  if (failures) {
    console.log(`❌ ${failures}/${citations.length} citations failed validation`);
    process.exit(1);
  }
  console.log(`✅ All ${citations.length} citations verified against Crossref`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
