# Contributing

Thanks for improving Member Berries.

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
npm pack --dry-run
```

## Design principles

- Be honest about deterministic local data versus host-model inference.
- Preserve cultural specificity: prefer regional variants and uncertainty over broad flattening.
- Keep user memories private; do not add network providers without explicit privacy documentation.
- Add tests before changing behavior.
- Keep package contents intentional; never publish local `.omx/`, `.omc/`, cache DBs, or transcripts.

## Commit messages

Use decision-oriented commit messages. Include what was tested and any known gaps.
