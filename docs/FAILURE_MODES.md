# Achiote — Failure Modes & Edge Cases

Complete enumeration sorted by **ROI / leverage** — highest-impact-for-effort first.
Original IDs (F1–F34, E1–E34) preserved for cross-reference.

---

## Tier 1 — Quick Wins (1–5 lines, immediate impact)

### #1 · [E5+E6] Regional matcher: empty-string and single-char match everything
**File:** `src/lib/regional-matcher.ts:16-21`
`findMatchingRegion("")` → every `includes("")` is true, returns first region. `findMatchingRegion("a")` → matches nearly all English city names.
**Fix:** 2 lines — `if (!normalized) return null;` + `if (normalized.length < 2) return null;`
**ROI rationale:** Two trivial guards prevent returning wrong region data to every caller.

### #2 · [E7] Substitution engine: division-by-zero → NaN scoring
**File:** `src/lib/substitution-engine.ts:19-20`
Empty `compounds: []` → `overlap.length / Math.max(0, 0)` → `NaN`. All NaN comparisons are `false` → ingredient gets zero substitutes, even from its own group.
**Fix:** 1 line — `if (targetCompounds.size === 0 && candidateCompounds.size === 0) continue;`
**ROI rationale:** One guard fixes broken substitution results for any ingredient with empty compounds.

### #3 · [E8+E9] Undefined substitution group grants false bonus + ugly output
**File:** `src/lib/substitution-engine.ts:22-23, 35`
`undefined === undefined` is `true` → two ingredients both missing `substitutionGroup` get a 0.2 bonus. Reasoning string shows `"undefined vs undefined"`.
**Fix:** 3 lines — null-check before comparison + fallback `(x ?? 'unknown')` for aroma.
**ROI rationale:** Two null checks eliminate false group bonuses and misleading LLM-facing text.

### #4 · [E3+E4] sanitizeForPrompt bypass vectors
**File:** `src/tools/results.ts:3-6`
`JSON.stringify` escapes `/` to `\/`, so `<\/user_input>` bypasses the regex. Trailing spaces like `</user_input >` also pass through. These are prompt injection vectors.
**Fix:** 2 lines — apply regex before `JSON.stringify`, or broaden to `/<\/?\s*user_input\s*>/g`.
**ROI rationale:** Two regex tweaks close the most accessible prompt injection surface.

### #5 · [E24] Silent auth failure on malformed ACHIOTE_API_KEYS
**File:** `src/lib/auth.ts:93-109`
Non-JSON env value → catch returns `[]` → identical to unset env. Server starts with NO keys, NO warning. All authenticated requests fail.
**Fix:** 1 line — `console.warn('ACHIOTE_API_KEYS: failed to parse')` in the catch block.
**ROI rationale:** One warning turns an invisible misconfiguration into a visible startup error.

### #6 · [E27] authenticate() iterates all keys after match
**File:** `src/lib/auth.ts:70-74`
`for...of` has no `break` after `return`. Every key is checked. Leaks key count via timing and wastes cycles.
**Fix:** 0 lines (add `break` before `return`, or restructure — the `return` already exits, but the loop structure suggests it could be a `find`).
**ROI rationale:** Trivial cleanup, minor timing-leak reduction.

### #7 · [E25] Silent key dedup — last-wins privilege escalation
**File:** `src/lib/auth.ts:62`
Duplicate keys with different tiers → `new Map()` keeps last entry. First record's tier silently dropped.
**Fix:** 3 lines — check for duplicates before Map construction, warn on conflict.
**ROI rationale:** Small validation prevents a privilege escalation scenario.

### #8 · [F7] No 413 response on body overflow
**File:** `src/http-server.ts` (readBody)
`req.destroy()` without HTTP response → client gets connection reset, not 413.
**Fix:** 1 line — `res.writeHead(413); res.end('Body too large');` before destroy.
**ROI rationale:** One line gives clients proper HTTP semantics.

### #9 · [E17] NaN propagation from maxEffortMinutes
**File:** `src/lib/memory-workflow.ts:946`
`Math.max(1, NaN)` → `NaN`. Propagates through output schema validation.
**Fix:** 1 line — `Math.max(1, input.maxEffortMinutes ?? 20) || 20`.
**ROI rationale:** One fallback prevents a schema-violating output.

### #10 · [E29] cache-path false positive on `..` substring
**File:** `src/lib/cache-path.ts:13`
`includes('..')` rejects `/home/user..backup/cache.db` — legitimate path.
**Fix:** 2 lines — use `path.normalize()` and check for actual parent-directory components.
**ROI rationale:** Two lines remove a false-positive security gate.

---

## Tier 2 — High Leverage (small effort, core functionality impact)

### #11 · [E1+E2] includesAny false positives on ingredient and sensory detection
**File:** `src/lib/memory-workflow.ts:79-81, 344-360`
`text.includes(needle)` → "dish" matches "fish", "photo" matches "hot" → false ingredient and sensory clues propagate through research, dossier, and MVN cue selection.
**Fix:** Replace `includesAny` with word-boundary matching (`\b`), same as `matchesWordOrPhrase`.
**ROI rationale:** Small regex change fixes the core matching logic that affects every user interaction.

### #12 · [F4] CORS reflects any Origin — no allowlist enforcement
**File:** `src/http-server.ts` (writeHead monkey-patch)
`ALLOWED_ORIGINS` parsed from env but never checked. Any website can make authenticated cross-origin requests.
**Fix:** Add `if (!ALLOWED_ORIGINS.includes(origin)) return;` before setting CORS header.
**ROI rationale:** One `if` check closes a CSRF-like attack surface.

### #13 · [E10] dataDrivenHypotheses returns only first matching family
**File:** `src/lib/memory-workflow.ts:496-538`
Returns immediately on first family match. "Empanada" in Latin American + Filipino families → only first-listed generates hypotheses.
**Fix:** Collect from all matching families, deduplicate, then limit.
**ROI rationale:** Small logic change doubles hypothesis coverage for cross-cultural dishes.

### #14 · [E11] REGION_TO_FAMILY_MAP missing entries for detected regions
**Files:** `src/lib/memory-workflow.ts:209-306, 409-486`
REGION_PATTERNS detects "Oaxacan", "Yucatecan", "Kenyan", "Somali", "Caucasus", etc. — but these have no FAMILY_MAP entry. Silent fallback to generic hypotheses.
**Fix:** Add missing entries (data-only change, no code).
**ROI rationale:** Pure data addition — no code risk, fixes silent quality degradation.

### #15 · [E31] No cross-reference validation between data files
**File:** `src/lib/data-schemas.ts`
Each dataset validated independently. Dish families may reference non-existent ingredients; regional-availability keys may be unused. Orphaned references → silent `undefined` lookups.
**Fix:** Add cross-reference checks in `validateBundledData`.
**ROI rationale:** Small validation addition catches data integrity issues at startup.

---

## Tier 3 — Important (moderate effort, resource/security fixes)

### #16 · [F1+E28] Rate limiter memory leak — month-based AND session-based growth
**File:** `src/lib/rate-limit.ts:17, 55`
`usage` Map grows by 2+ entries per unique key per month. `web:${sessionId}` with ephemeral UUIDs grows faster than F1 alone. No eviction.
**Fix:** Periodic sweep of stale entries, or LRU eviction with TTL.
**ROI rationale:** One cleanup function prevents unbounded memory growth in production.

### #17 · [F8] SSE stream — zombie API calls after client disconnect
**File:** `src/http-server.ts` (handleAsk)
Client drops → `res.write()` fails but Anthropic loop continues (up to 15 iterations). Wastes API credits.
**Fix:** Check `res.writableEnded` between iterations.
**ROI rationale:** One check per loop iteration stops burning Anthropic credits on dead connections.

### #18 · [F10] MCP session map grows without bound
**File:** `src/http-server.ts` (transports Map)
Sessions only cleaned on `transport.onclose` or SIGINT. Network drops leave stale entries.
**Fix:** TTL-based sweep (e.g., idle >30 min).
**ROI rationale:** Same pattern as #16 — one sweep function prevents production leak.

### #19 · [F11] Static file serving — incomplete path traversal protection
**File:** `src/http-server.ts` (serveStatic)
`startsWith(STATIC_DIR)` can be bypassed on case-insensitive filesystems (macOS).
**Fix:** Use `resolve()` on both sides before comparing.
**ROI rationale:** Small path-handling change closes a traversal vector.

### #20 · [F5+F6] SQLite cache — no error handling + phantom hit counts
**File:** `src/lib/research-cache.ts:26-33, 51-58`
Disk full, corruption, or locked DB → unhandled exceptions. `hit_count` incremented before read.
**Fix:** Wrap DB ops in try/catch, return null on failure. Move increment after successful read.
**ROI rationale:** Standard defensive coding — prevents crashes from environmental issues.

---

## Tier 4 — Quality Improvements (visible impact, non-trivial effort)

### #21 · [E13+E20] Non-ASCII name extraction + non-English stopwords
**File:** `src/lib/memory-workflow.ts:94-97, 100-108`
Regex `[a-zA-Zñáéíóúü-]` only handles Spanish. "de", "la", "el" not in stopwords. Greek, Japanese, Turkish names dropped.
**Fix:** Broaden character class to `\p{L}` with Unicode flag. Add common non-English function words.
**ROI rationale:** Opens the pipeline to non-Spanish non-English food memories.

### #22 · [E16] Research provenance patterns are English-only
**File:** `src/lib/research-provenance.ts:5-16, 70`
INGREDIENT_PATTERNS and regions only match English. Non-English research sources produce incomplete extracted facts.
**Fix:** Add multilingual patterns or use language-agnostic extraction.
**ROI rationale:** Completes research extraction for non-English sources.

### #23 · [E12] normalize() diacritic stripping causes cross-language collisions
**File:** `src/lib/name-resolver.ts:35-42`
`"pâté"` = `"pate"`, `"año"` = `"ano"` — different words in different languages treated as exact matches.
**Fix:** Maintain a language-aware matching table, or use locale-sensitive comparison.
**ROI rationale:** Prevents false exact matches across languages — complex but correct.

### #24 · [F12+F13] O(n×m) name resolver + O(n²) substitution scan
**Files:** `src/lib/name-resolver.ts:78-128`, `src/lib/substitution-engine.ts:6-41`
~2,400 Levenshtein calculations per name lookup. Full ingredient scan per substitution call. Both called multiple times per `/ask`.
**Fix:** Pre-build lookup index at startup.
**ROI rationale:** Performance investment for scale. Not needed at current data size.

### #25 · [E19] toolError path redaction over-strips non-path slashes
**File:** `src/tools/results.ts:17`
Regex `/\/[^\s"']+/g` strips JSON paths and URLs from error messages, removing debugging context.
**Fix:** Refine regex to only match filesystem paths (check for common prefixes or extensions).
**ROI rationale:** Better error messages for debugging.

### #26 · [E21] resolveDishName returns raw unsanitized input on no-match
**File:** `src/lib/name-resolver.ts:196`
Raw user input propagated as `canonicalName` into cache keys and JSON output. No length bound.
**Fix:** Apply `normalize()` and truncate the fallback.
**ROI rationale:** Prevents unbounded strings in output — rare but possible.

### #27 · [E14] buildReconstructionDossier confidence inflated by duplicate facts
**File:** `src/lib/memory-workflow.ts:616`
Two identical strings count as two facts toward "Medium" confidence threshold.
**Fix:** Deduplicate `researchedFacts` before counting.
**ROI rationale:** One dedup call makes confidence reporting honest.

### #28 · [E15] validateResearchRecord early-returns on empty sources
**File:** `src/lib/research-provenance.ts:104-107`
Returns after reporting only the empty-sources issue. Other validation errors are hidden.
**Fix:** Continue validating all fields before returning.
**ROI rationale:** Complete error reporting — small logic change.

### #29 · [E23] Research cache store() with empty dbPath creates temp database
**File:** `src/lib/research-cache.ts:10`
`new ResearchCache("")` → `path.dirname("")` → `"."` → SQLite temp DB → data lost on close. No warning.
**Fix:** Validate `dbPath` is non-empty before constructing.
**ROI rationale:** One validation prevents silent data loss from misconfiguration.

### #30 · [F23+F24] Frontend: XSS-safe but wiring broken on static app
**Files:** `docs/landing/app.js:95-102`, `docs/landing/app.html:227-229`
`formatMd` escapes HTML (safe) but broken formatting. Suggestion buttons use `onclick` instead of `data-suggestion` attributes — `app.js` listeners never fire.
**Fix:** Add `data-suggestion` attributes to HTML buttons, remove `onclick`.
**ROI rationale:** Makes the static demo actually functional.

---

## Tier 5 — Low Priority (cosmetic, theoretical, by-design, tuning)

### #31 · [E26] safeEqual timing oracle via length check
**File:** `src/lib/auth.ts:53`
Wrong-length keys return immediately (fast), correct-length wrong-value go through timingSafeEqual (slow). Key length is predictable from `ach_` prefix convention.
**Fix:** Compare against a constant-time hash instead, or accept the minor leak.

### #32 · [E30] Unicode normalization mismatch in ingredient key lookup
**File:** `src/lib/substitution-engine.ts:7`
Precomposed `ñ` (U+00F1) vs decomposed `n`+combining-tilde treated as different keys.
**Fix:** Apply `.normalize('NFD').replace(...)` like name-resolver does.

### #33 · [E32] extractRegionHints geographic pattern false positive on sentence-initial "In"
**File:** `src/lib/memory-workflow.ts:310`
"In And Something happened" → captures "And Something" as a place name.
**Fix:** Anchor to not match at sentence start, or require lowercase "in".

### #34 · [E22] "baba" matches both grandmother AND father
**File:** `src/lib/memory-workflow.ts:363-365`
Slavic grandmother vs South Asian father — contradictory tags. Both are "family context" variants.
**Fix:** Disambiguate by surrounding context or accept both as family context.

### #35 · [E33] wordSignal regex does not escape pipe-delimited keywords
**File:** `src/lib/memory-workflow.ts:774-776`
Current keywords are safe literals, but regex metacharacters in future keywords would be interpreted.
**Fix:** Use `escapeRegExp` on keywords before joining with `|`.

### #36 · [E34] "fish" substring false positive (low real-world impact)
**File:** `src/lib/memory-workflow.ts:79-81`
"selfish" matches "fish". Superseded by fix for #11 (E1+E2).
**Fix:** Same as #11 — word-boundary matching.

### #37 · [E18] sanitizeLocation truncation loses useful suffix
**File:** `src/lib/memory-workflow.ts:732-736`
80-char truncation can cut zip codes, apartment numbers.
**Fix:** Truncate at last comma or space before limit.

### #38 · [F2] Rate limiter race condition under concurrency
**File:** `src/lib/rate-limit.ts:29-39`
Read-then-write on Map. Currently safe in Node.js single-thread. Risk only if extracted to worker/shared state.
**Fix:** Architectural note — no action needed now.

### #39 · [F3] Prompt injection via user input tags
**File:** `src/tools/results.ts:3-6`
Superseded by fix for #4 (E3+E4). Original concern: crafted `</user_input>` variants bypass filter.

### #40 · [F9] No timeout on individual Anthropic API calls
**File:** `src/http-server.ts` (handleAsk, ~578-618)
Each `anthropic.messages.create()` has no timeout. API hang → holds SSE connection indefinitely.
**Fix:** Add `timeout` option or AbortController.

### #41 · [F14] Regex state risk in REGION_PATTERNS
**File:** `src/lib/memory-workflow.ts:209-306`
Currently safe — no `g` flag on patterns. Architectural note if patterns change.

### #42 · [F15] SSE parser silently drops non-string error payloads
**File:** `docs/landing/app.js:77-84`
`event: error` objects ignored. Users see no error when server sends error event.
**Fix:** Handle non-string payloads in stream parser.

### #43 · [F16] JSON.stringify changes semantic meaning
**File:** `src/tools/results.ts:3-6`
`"hello \"world\""` inside `<user_input>` distorts quotes in memories like `grandma called it "sopa"`.
**Fix:** Apply sanitization before stringify, or use alternative encoding.

### #44 · [F17] Regional matcher substring false positives
**File:** `src/lib/regional-matcher.ts:15-17`
Superseded by fix for #1 (E5+E6). "bay" matches "bay-area", "los" matches "los-angeles".

### #45 · [F18] Regional matcher only covers US regions
**File:** `src/data/regional-availability.json`
International users get no sourcing data. By design for now.

### #46 · [F19] Ingredient lookup — exact slug match only
**File:** `src/lib/substitution-engine.ts:7-10`
"cumin" won't find "cumin-seeds". Aliases exist in data but aren't checked during lookup.
**Fix:** Check aliases in addition to primary key.

### #47 · [F20] REGION_PATTERNS double-matches overlapping terms
**File:** `src/lib/memory-workflow.ts:209-306`
"South Indian" → both "South Asian" and "Indian". Extra noise, not incorrect.

### #48 · [F21] Zod structuredContent not validated at runtime
**File:** `src/server.ts`
Schemas are documentation, not enforcement. TypeScript compilation is the guard.
**Fix:** Add runtime validation if needed for untrusted callers.

### #49 · [F22] generate_recipe — no guard against calling before MVN
**File:** `src/server.ts:511-578`
LLM host trusted to follow instructions. Malicious client could bypass pipeline.
**Fix:** Add state tracking or accept LLM trust model.

### #50 · [F25] Cache path — no graceful fallback
**File:** `src/lib/cache-path.ts`
Non-existent parent directory → `mkdirSync` throws → server crash on startup.
**Fix:** Try/catch with fallback to default path.

### #51 · [F26] loadKeysFromEnv — no size limit on env var
**File:** `src/lib/auth.ts:95-115`
Arbitrarily large env var consumed by JSON.parse. OS limits prevent this in practice.

### #52 · [F27] Levenshtein early-exit skips >30% length difference
**File:** `src/lib/name-resolver.ts:17`
10-char vs 14-char (40% diff) never fuzzy-matched. Quality tuning.

### #53 · [F28] Ambiguity threshold hardcoded at 0.12
**File:** `src/lib/name-resolver.ts:170`
May need tuning. Not a bug — quality knob.

### #54 · [F29] "curry/curried" special-case regex
**File:** `src/lib/memory-workflow.ts:59-73, 117-120`
Maintainability trap — new slash-delimited hints need similar special handling.

### #55 · [F30] No request timeout on HTTP server
**File:** `src/http-server.ts`
Combined with #40 (F9), single request could hold connection for minutes.
**Fix:** Set `server.requestTimeout` and `server.headersTimeout`.

### #56 · [F31] Infinity in rate limit response headers
**File:** `src/lib/rate-limit.ts:52`
`String(Infinity)` → `"Infinity"` in headers. Cosmetic — clients should handle non-numeric values.

### #57 · [F32] No CSP header on static file responses
**File:** `src/http-server.ts` (serveStatic)
Meta-tag CSP is sufficient for HTML, but HTTP headers would be more robust.

### #58 · [F33] Static app has no API key input
**File:** `docs/landing/app.js`
Calls `/ask` without `x-api-key`. Unusable when `ACHIOTE_AUTH_ENABLED=true` (default).
**Fix:** Add API key input field matching React frontend.

### #59 · [F34] JSON imports use `with { type: 'json' }` assertion
**File:** Multiple files
ES2022 feature. Safe with Node 22+ target. Breaks on older runtimes.

---

## Summary

| Tier | Items | Theme | Effort |
|------|-------|-------|--------|
| 1 · Quick Wins | #1–#10 (10 items) | One-line guards, trivial validation | 1–5 lines each |
| 2 · High Leverage | #11–#15 (5 items) | Core matching, CORS, data completeness | Small function or data change |
| 3 · Important | #16–#20 (5 items) | Memory leaks, error handling, path security | Moderate — sweep/cleanup logic |
| 4 · Quality | #21–#30 (10 items) | i18n, performance, validation, frontend wiring | Non-trivial but well-scoped |
| 5 · Low Priority | #31–#59 (29 items) | Cosmetic, theoretical, by-design, tuning | Fix when convenient |

**Recommended fix order:** Start with Tier 1 (#1–#10) — all can be done in one pass. Then Tier 2 (#11–#15) for core correctness. Tiers 3–4 when scaling. Tier 5 as time permits.
