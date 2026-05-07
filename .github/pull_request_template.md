## Summary

-

## Verification

- [ ] `npm run check`
- [ ] `npm run package:smoke`
- [ ] `npm audit --audit-level=moderate`
- [ ] `npm pack --dry-run`
- [ ] `npm run docker:smoke` when Docker/runtime changes
- [ ] Browser/screenshot review when landing UI changes

## Risk / rollback

-

<!-- EMPOWER_ORCHESTRATOR:START -->
## Empower Orchestrator checklist

- [ ] I checked whether this PR reveals a repeatable task or recurring agent failure.
- [ ] If it does, I either shipped the smallest durable improvement or documented why not.
- [ ] Any automation or durable system change included the scale/severity/reversibility/predictability blast-radius check.
- [ ] Workers/subagents stayed inside their assigned scope and verification evidence is included before completion claims.
<!-- EMPOWER_ORCHESTRATOR:END -->
