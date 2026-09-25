# Privacy and Data Retention

Food memories are personal. Achiote is built so the sensitive part, the raw memory you type, never lands
on disk. This document says exactly what is stored, what is not, how long it lives, and how to delete it.

## The short version

**Raw user food memories are not persisted.** Your memory text, conversation history, and any images you
send are held only in process memory for the duration of a single reconstruction, then dropped. They are
never written to a database, a log line, a cache, or an analytics payload.

The only things Achiote writes to disk are operational stores that hold no personal memory text: a research
cache about dishes, a billing database (server only), and an optional rate-limit database. You can wipe all
of them with `achiote purge --yes`.

## What is stored

| Store | Default path | What it holds | Personal memory text? |
| --- | --- | --- | --- |
| Research cache | `~/.cache/achiote/culture-cache.db` (`ACHIOTE_CACHE_PATH`) | Dish/region research records keyed by `(dish_family, region)`: canonical names, regions, ingredients, techniques, source URLs. Sourced from research, not from you. | No |
| Billing database | `~/.cache/achiote/billing.db` (`ACHIOTE_BILLING_DB`) | Stripe customer/subscription ids, hashed API keys (never plaintext), tier, credit counters. Only created when billing is configured on a server. | No |
| Rate-limit database | none by default (`ACHIOTE_RATE_LIMIT_DB`) | A SHA-256-keyed counter per scope. In-memory unless you point it at a file. | No |

Evidence, for auditors:

- Research cache schema is `(dish_family, region, research_data, created_at, hit_count)` with the value a
  serialized research record about a dish, not a user message: `src/lib/research-cache.ts:18-26`,
  `storeResearchRecord` at `src/lib/research-cache.ts:43-45`. The cache key is a dish family and region,
  never the raw memory.
- Billing columns are Stripe ids, hashed keys, tiers, and credits: `src/lib/billing-db.ts` schema block
  (around `:115-166`). No memory text.
- Rate-limit rows are `(key, count, period_start)` where `key` is a hash: `src/lib/rate-limit.ts:46-52`.

## What is not stored

- **Your raw memory text** (`userMessage` / `rawMemory`). It flows through the engine in memory and is
  never written anywhere. The Memory Receipt that summarizes a run is returned to you in the response
  stream and is not saved server-side.
- **Conversation history and images.** Passed per request, held in memory, dropped after the response.
- **Quality signals are aggregates only.** When `consent.qualitySignals` is true, Achiote records normalized
  buckets: memory type, family bucket, region bucket, language, which clue dimensions were missing, search
  and cache outcomes, and which guard fired. No raw text. The shape is in `src/lib/quality-signals.ts:8-17`,
  and the recorder only increments counters: `recordQualitySignal` at `src/lib/quality-signals.ts:103-112`.
  This report lives in process memory and is served at the admin `/events` endpoint; it is not written to
  disk.
- **Telemetry is sanitized and never includes memory text.** Only an allow-list of low-cardinality
  properties (route, source, category, tier, mode, billing, reason, hasHistory, emailDomain) is accepted,
  and values must match a strict character class. See `src/lib/telemetry-collector.ts` (the
  `ALLOWED_PROPERTIES` allow-list and `sanitizeTelemetryProperties`). PostHog forwarding, when enabled,
  sends only those sanitized properties.
- **Logs do not contain memory text.** Engine diagnostics log counts and tool names, for example
  `model_response content=text:1,tools:0`, never the memory itself. Diagnostics go to STDERR (HTTP and CLI)
  or to nowhere (MCP stdio), through an injected structured logger (`src/core/logger.ts`).

## Consent flags

The request can carry a consent object: `analytics`, `qualitySignals`, `savedMemory`, `familyConfirmation`,
`publicContribution`.

- `analytics` gates whether a telemetry event is recorded.
- `qualitySignals` gates whether the aggregate quality signal is counted.
- `savedMemory`, `familyConfirmation`, and `publicContribution` are accepted for forward compatibility but
  currently gate no persistence. Nothing is saved, confirmed with family, or published regardless of their
  value. If a future version adds saved-memory or public-contribution features, they must be opt-in behind
  these flags and documented here before any raw memory is written.

## Retention windows

- **Raw memories: zero.** Not retained past the single request.
- **Research cache:** retained until deleted. There is no TTL; entries are about dishes, not people, and a
  512 KB per-entry cap applies (`src/lib/research-cache.ts`). Delete with `achiote purge`.
- **Billing database:** retained for the life of the billing relationship, managed by the operator. Delete
  with `achiote purge` (or remove the file).
- **Rate-limit database:** ephemeral by default (in-memory). If file-backed, counters roll over by period.

## How to delete your data

Because no raw memory is stored, there is nothing personal to erase per user. To wipe Achiote's local
operational stores entirely (for example before handing off a machine or resetting an environment):

```bash
# Dry run: report what would be removed, delete nothing
achiote purge

# Actually delete the local stores (cache, billing, and rate-limit if configured),
# including SQLite WAL/SHM sidecar files
achiote purge --yes
```

`purge` resolves paths from the same environment variables the server uses (`ACHIOTE_CACHE_PATH`,
`ACHIOTE_BILLING_DB`, `ACHIOTE_RATE_LIMIT_DB`), so it targets whatever your deployment actually wrote.
Implementation: `src/cli-purge.ts`.

To delete manually instead, remove the files listed in the table above along with any `-wal`, `-shm`, and
`-journal` sidecars next to each `.db`.

## Reporting

Found something that contradicts this document, or a path that writes memory text? That is a privacy bug.
Open an issue or see `SECURITY.md` for how to report it.
