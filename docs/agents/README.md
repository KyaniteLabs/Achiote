# Agent Guidance

Use GitHub issues as the issue tracker for architecture and launch work.

## Labels

- `architecture`: module boundaries, domain seams, controller extraction, and long-lived contracts.
- `refactor`: behavior-preserving restructuring.
- `documentation`: repo docs, ADRs, domain language, public docs.
- `needs-triage`: new work that has not yet been ranked or accepted.

## Routing Notes

- Read `CONTEXT.md` before architecture reviews so terms are not re-inferred from scattered files.
- Check `docs/adr/README.md` before proposing new boundaries.
- For database population work, use the QA artifact manifest and reference pantry append path; do not paste canary prompt text into production data.
- Close issues only after implementation, verification, merge/sync, and an evidence comment naming the verification commands.
