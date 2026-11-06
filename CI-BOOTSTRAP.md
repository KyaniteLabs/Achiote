# Hermes CI bootstrap disclosure

The plugin CI uses the unchanged upstream Hermes lock, including its explicit
Pillow override. This is a CI installer correction, not a runtime fork or a
new dependency-policy exception.

## Decision

- Keep Hermes source pin `e76fbd80be65ea5c1b89831f8d7aaedb713f5cac`.
- Keep `browser-harness==0.1.13` and security-fixed `Pillow==13.0.0`.
- Replace `pip install -e ./.hermes-runtime` with pinned `uv==0.11.22` and
  `uv sync --project .hermes-runtime --locked --no-dev` on Python 3.14.
- Execute the original unit-test and validator commands through that runtime's
  `.venv/bin/python` and `.venv/bin/hermes`. The JavaScript syntax check stays.

The runtime already declares `Pillow==13.0.0` in both `[tool.uv].override-dependencies`
and `uv.lock`'s manifest. pip does not consume this uv policy and therefore rejects
browser-harness's stale `pillow==12.3.0` metadata. The upstream rationale is in
[`pyproject.toml`](https://github.com/NousResearch/hermes-agent/blob/e76fbd80be65ea5c1b89831f8d7aaedb713f5cac/pyproject.toml#L650-L661)
and [commit 27c6146](https://github.com/NousResearch/hermes-agent/commit/27c61463814f27ada4c2d5625a8839ed51f01f41):
Pillow 13 fixes security advisories without changing the browser image operations
used there. Downgrading Pillow or Hermes to bypass those fixes is rejected.

`--locked` refuses a stale lock instead of re-resolving dependencies. CI also checks
that the runtime checkout has no tracked changes. No runtime source or lock edits,
`--no-deps` install, new override, bundled binaries, assertion removal, allowed
failure, or validation skip is introduced. Upstream's existing lock-aware dependency
checker is unchanged; an ordinary pip check can still report the disclosed metadata
mismatch. That expected metadata mismatch is not a claim of general compatibility.

## Exposure, scope, rollback

Only CI installation and its documentation change. Existing read-only job permissions,
pinned actions, runtime pin, plugin code, unit assertions and validator remain intact.
Dependencies still download from their upstream sources; no binaries are committed.
No host deployment, credentials, service operation, or package/catalog publication is performed.
Rollback is a normal revert of the CI correction (which restores the known resolver
failure); do not downgrade the security-fixed dependency as a workaround.

## PR-packet note

Copy this disclosure into the implementation/catalog packet: **CI honors the pinned
Hermes runtime's pre-existing, upstream-sanctioned Pillow 13 override over
browser-harness 0.1.13's Pillow 12.3 metadata using locked uv sync. Neither runtime
pin moved; runtime source and plugin validation are unchanged.** A successful CI run
proves this plugin's configured gates, not browser coverage, live Desktop behavior,
media readiness, catalog acceptance, merge, or production deployment.
