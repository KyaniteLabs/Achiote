# Achiote

Achiote helps people reconstruct remembered family foods and drinks from fragments: a sound-alike name, a smell, a texture, a place, or who made it. Its heart is **structured elicitation**, not instant recipe generation: collect clues, identify what is missing, ask gentle discriminating questions, and let the family correct the hypothesis.

## Core experience

A memory becomes structured intake, a research plan, and a reconstruction dossier separating **user-said, researched, inferred, and unknown** claims. The first practical result should be a **minimum viable nostalgia cue**: a small, accessible aroma, bite, sip, condiment, or ritual to test the memory. Family follow-up questions and a portable Memory Receipt support correction. Sourcing, substitutions, sensory analysis, and a fuller recipe handoff are optional next steps, not a substitute for elicitation.

Implementation: [collector](src/lib/food-memory-collector.ts), [workflow planner](src/lib/workflow-planner.ts), [dossier](src/lib/reconstruction-dossier.ts), [cue generator](src/lib/nostalgia-cue-generator.ts), and [tool registry](src/tools/tool-registry.ts).

## What exists in this repository

- MCP over stdio and optional Streamable HTTP; a single-call reconstruction tool and granular workflow tools.
- HTTP `/ask` streaming conversation and the browser detective at `/app`; landing, pricing, trust/support pages, and fragment-based `/receipt` sharing under [docs/landing](docs/landing/).
- Name/alias resolution, ingredient substitutions, static regional sourcing hints, typed research provenance, optional configured web search, and a local SQLite research overlay.
- Optional local speech input/read-aloud, provider adapters, access/rate controls, and billing integration code. Their presence does not establish deployment readiness or speech quality.

## Bundled reference datasets

Counts below describe committed source data, not universal coverage or verified family recipes:

| Dataset | Existing content and role |
| --- | --- |
| [dish-families.json](src/data/dish-families.json) | 55 families: aliases, transliterations, regional differences, nostalgia triggers |
| [ingredients.json](src/data/ingredients.json) | 83 ingredients: compounds and substitution groups |
| [sensory-profiles.json](src/data/sensory-profiles.json) | Five sensory dimensions and nostalgia-critical criteria |
| [regional-availability.json](src/data/regional-availability.json) | 15 regional records plus sourcing layers; static hints, not shop inventory |
| [food-science-references.json](src/data/food-science-references.json) | 101 mechanism records with reference material for sensory reasoning |
| [reference-pantry-fixtures.json](src/data/reference-pantry-fixtures.json) | 1,358 typed research fixtures, used as bundled grounding without SQLite bootstrapping; broad structured-data context, not family confirmation |
| [memory-hints.json](src/data/memory-hints.json) | Ingredient, method, regional, and concept clues for intake |
| [fault-patterns.json](src/data/fault-patterns.json) | 28 symptom/mechanism/fix records; not evidence that a fault-finder UI is shipped |

The family taxonomy, global coverage matrix, seed queue, warming manifest, source registry, corrected research targets, and inference-burden inventory also exist in [src/data](src/data). These organize coverage, retrieval, source policy, and operator work; planning targets are not researched culinary facts. Source policy allows approved CC0/public-domain structured fixtures and separately flags sources needing review.

## Limits and verification

The host/provider model still interprets and synthesizes. Search requires configuration; static sourcing is not live availability. Sparse clues must not become a confident dish identification, and dietary/allergy adaptation is not a safety guarantee. Shared receipts may contain sensitive family memories: anyone possessing the fragment link can read them.

This document describes source-inspected capabilities. Build and targeted workflow tests are reproducible checks, not proof of the hosted experience. User-side evidence and independent review remain necessary before accepting the product as working.
