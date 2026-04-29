# Quality Signal Telemetry Design

## Goal

Give Achiote a privacy-preserving data-engineering signal layer so operators can see which normalized food-memory categories, missing-clue dimensions, guard paths, search behavior, and cache outcomes need hardening before pre-populating reference data.

## Scope

This is slice A only: instrumentation and normalization. It does not seed the research cache, call production, run live LLMs, or store raw user memories.

Slice B should follow after this and must be global in scope: all food and drink categories, regions, cultures, languages, aliases, preparations, serving rituals, and sensory mechanisms. Beverages are one category, not the whole seed plan.

## Architecture

Add a pure `src/lib/quality-signals.ts` module that derives a compact `AskQualitySignal` from existing structured `/ask` tool payloads and tool state. The module should emit bounded, normalized strings only: memory type, family key, region key, language/script key, missing dimensions, guard reason, search behavior, and cache outcome.

Wire successful `/ask` endings to call a single recorder before `done`. The recorder updates a new in-memory `qualitySignalCounters` aggregate that is exposed only through the existing operator-authenticated `GET /events` response. Public telemetry submission remains unchanged and cannot submit arbitrary quality data.

## Privacy Boundary

Do not store raw prompts, raw memory text, full assistant answers, source snippets, URLs, or user-identifying fields. Use normalized categories and small bounded labels only. Unknown or high-cardinality values collapse to stable buckets such as `unknown`, `other`, `unavailable`, or `broad`.

## Signal Shape

Each signal should include:

- `memoryType`: `beverage`, `dish`, `sauce_broth`, `confectionery`, or `unknown`.
- `familyKey`: normalized dish family or `unknown`.
- `regionKey`: normalized non-broad region/culture hint or `unknown`.
- `languageKey`: normalized multilingual/script clue or `unknown`.
- `missing`: zero or more of `missing_name`, `missing_region`, `missing_ingredient`, `missing_format`.
- `search`: `called`, `capped`, `skipped`, or `not_applicable`.
- `cache`: `unavailable`, `miss`, `hit`, or `fallback`.
- `guarded`: final guard reason or `none`.

## Operator Report

`GET /events` with `ACHIOTE_EVENTS_ADMIN_TOKEN` should include:

```json
{
  "counters": {},
  "breakdowns": {},
  "quality": {
    "total": 0,
    "byMemoryType": {},
    "byFamily": {},
    "byRegion": {},
    "byGuard": {},
    "bySearch": {},
    "byCache": {},
    "missing": {}
  }
}
```

The report is intentionally aggregate-only. It should be reset on process restart like existing telemetry counters.

## Testing

Start with pure unit tests for signal normalization. Then add an HTTP integration test proving `/ask` successful paths update the private operator report without exposing raw memory text. Existing public `/events` behavior must remain unchanged.

