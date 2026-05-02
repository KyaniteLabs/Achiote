# ADR 0003: Named Runtime and Launch Surface Boundaries

## Status

Accepted.

## Context

The architecture audit found that several product-critical behaviors were implemented correctly but were too easy to lose inside broad files:

- provider/model routing in `src/http-server.ts`
- auth, billing, credits, and rate-limit decisions in HTTP route code
- local speech route behavior mixed with transport plumbing
- minimum viable nostalgia cue policy and constraint rewrites inside `src/lib/memory-workflow.ts`
- browser app primitives embedded in `docs/landing/app.js`
- package contents enforced indirectly by `package.json` and smoke scripts

This made future changes slower and riskier because agents had to re-infer ownership before editing.

## Decision

Achiote treats the following as named long-lived boundaries:

- `ProviderRuntime` owns provider/model profile resolution and ask-session adapter creation.
- `AccountAccess` owns auth, billing, credits, anonymous demo policy, and rate-limit decisions.
- `LocalSpeechController` owns HTTP voice status, transcription, and synthesis response shaping.
- `CueProfileEngine` owns cue profile evidence surfaces and component/mechanism extraction boundaries.
- `ConstraintAdapter` owns dietary, allergy, and religious constraint rewrites for cues.
- `ProductApp` owns browser primitives for SSE parsing, HTTP error copy, and chat-history updates.
- `PackageSurface` owns the intentional npm tarball surface and forbidden packaged artifacts.

Public launch routes remain static and dependency-free unless a future ADR explicitly approves a hosted dependency. Shareable receipt links use URL fragments so the server serves the renderer but does not receive the receipt payload.

## Consequences

- Future work should extend the owning boundary first instead of adding more behavior directly to `src/http-server.ts`, `src/lib/memory-workflow.ts`, or `docs/landing/app.js`.
- Guardrail tests should assert the owning module rather than stale monolith implementation details.
- Package-affecting route additions must update `package.json`, `scripts/lib/package-surface.mjs`, `docs/landing/sitemap.xml`, and package/static route tests together.
- Do not add fake testimonials, fake social links, or external launch services as placeholders. Trust surfaces should be factual or absent.
