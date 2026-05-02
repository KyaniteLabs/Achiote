# ADR 0001: Research-first Reconstruction Boundary

## Status

Accepted.

## Context

Achiote reconstructs food memories from incomplete, culturally specific, and emotionally loaded user fragments. A confident recipe response too early can erase uncertainty, invent authority, or push the user toward hard-to-find ingredients before the memory has been tested.

## Decision

Achiote's core product boundary is research-first reconstruction. The server should collect memory clues, plan research, validate provenance, build dossiers, and produce minimum viable nostalgia cues before recipe-like output.

The first food output should be a cheap, accessible, mechanism-grounded cue. It should separate `userSaid`, researched facts, inferred facts, and unknowns.

## Consequences

- The model still owns humane synthesis and ambiguity handling.
- Deterministic code owns workflow state, provenance, minimum output contracts, and safety guardrails.
- Features that jump directly to recipes must be opt-in and clearly downstream of the minimum-cue path.
