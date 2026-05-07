# Contributing

Thanks for improving Achiote.

## Development setup

```bash
npm ci
npm run typecheck
npm run build
npm test
```

Use `npm ci` for reproducible installs from `package-lock.json`.

## Quality bar

Before opening a pull request, run:

```bash
npm run typecheck
npm run build
npm test
npm audit --audit-level=moderate
npm run package:smoke
npm run pack:check
```

## Design principles

- Be honest about deterministic bundled data versus host-model inference.
- Preserve cultural specificity: prefer regional variants and uncertainty over broad flattening.
- Keep user memories private; do not add network providers without explicit privacy documentation.
- Add tests before changing behavior.
- Keep package contents intentional; never publish `.omx/`, `.omc/`, cache DBs, or transcripts.

## Commit messages

Use decision-oriented commit messages. Include what was tested and any known gaps.

<!-- EMPOWER_ORCHESTRATOR:START -->
## Agent-law contribution rule

This repository follows the Empower Orchestrator law in `docs/agent-law/empower-orchestrator.md`.

If a change exposes a repeated task or repeated agent failure, contributors and agents should either ship the smallest durable prevention artifact or explain why this PR is intentionally one-off.

Automation and durable system changes require the scale/severity/reversibility/predictability blast-radius check before dispatch.
<!-- EMPOWER_ORCHESTRATOR:END -->
