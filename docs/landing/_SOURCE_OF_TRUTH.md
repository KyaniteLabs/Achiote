# THIS is the LIVE Achiote site. Read before editing.

The live landing page + app are served from THIS directory
(`/docker/achiote/source/docs/landing/`) on the VPS. Edits here go live after a deploy.

- The PUBLIC GitHub repo (`simongonzalezdc/achiote-food-memory-researcher`) is the
  competition SUBMISSION FOLDER only (identity/rules/examples/reference/README). It does
  NOT contain this website. Editing the website there does NOTHING to the live site.
- To change the live site: edit files HERE, then run `bash /docker/achiote/safe-deploy.sh`.
  safe-deploy builds, restarts, runs `canary.sh`, and AUTO-ROLLS-BACK on any regression.
  Never run a raw `docker compose build` without the canary gate.

## Locked invariants (canary.sh enforces these; do not undo)
- app.html `.composer` is `background: transparent;` — NEVER a gradient.
- Homepage says "a Sunday ritual", never "the shape of a Sunday".
- Mobile nav links stay visible (no `display:none` on `.nav-links` at max-width:900px), so Meaning is reachable.
- Mobile body background is `background-attachment: scroll` (fixed looks blurry on phones).
- The demo stays open: `ACHIOTE_ALLOW_ANON_ASK=true` and `ACHIOTE_ANON_WEB_RECONSTRUCTIONS>=1000` (default is 3/month and locks the demo).
