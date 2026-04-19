# Contributing

Thanks for improving Member Berries, the current repository codename for a research-first food-memory reconstruction MCP/skill core.

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
