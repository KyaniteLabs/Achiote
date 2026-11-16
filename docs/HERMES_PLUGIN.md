# Hermes plugin pipeline

Achiote ships to [Hermes](https://github.com/KyaniteLabs/hermes-agent) as a portable
Agent Plugins v1 package in `plugins/achiote/`. Hermes lists plugins in its
`plugin-catalog/` directory, one YAML file per plugin, pinned to an exact commit SHA.

## How the pieces fit

```
package.json version ─┐
skill/SKILL.md ───────┤  node scripts/hermes-plugin.mjs sync
branding/*.png ───────┼──────────────────────────────────────►  plugins/achiote/
LICENSE ──────────────┘                                          (plugin.json, mcp.json,
                                                                  skills/, icon.png, banner.png)
                                   npm run lint  ── fails if plugins/achiote/ drifted
release commit SHA ──► node scripts/hermes-plugin.mjs catalog-entry --sha <sha>
                   ──► PR to hermes-agent: plugin-catalog/achiote.yaml
```

## Release steps

1. **Bump and sync.** Bump `version` in `package.json` (and `server.json`), then run
   `node scripts/hermes-plugin.mjs sync`. Commit the result. `npm run lint` checks it.
2. **Publish to npm first.** `mcp.json` launches `npx -y achiote@<version>`, so that exact
   version must exist on npm before anyone installs the plugin.
3. **Merge to `master`** and note the full 40-character merge commit SHA.
4. **Validate at that SHA** from a `hermes-agent` checkout:
   ```bash
   git clone https://github.com/KyaniteLabs/Achiote /tmp/achiote && git -C /tmp/achiote checkout <sha>
   hermes plugins validate /tmp/achiote/plugins/achiote
   ```
   Expected: `portable manifest`, `manifest fields` and `security scan: safe` all pass.
5. **Generate the catalog entry:**
   ```bash
   node scripts/hermes-plugin.mjs catalog-entry --sha <sha> > achiote.yaml
   ```
   It refuses anything but a full SHA, because the catalog loader rejects branches,
   tags and short SHAs.
6. **Open a PR to `hermes-agent`** adding `plugin-catalog/achiote.yaml`. A version bump
   later is a new PR that changes `sha` and `version` together (catalog rule 4).

## Catalog rules this package already meets

| Catalog rule | How |
|---|---|
| Exact SHA pin | `catalog-entry` only accepts a 40-hex SHA |
| No self-updating code | `npx` is pinned to `achiote@<exact version>`; no updater in the package |
| Declared capabilities match reality | portable package: no Python tools, hooks or middleware, so all `capabilities` lists are empty |
| Security scan | `safe` at the time of writing |
| Desktop SDK surface | no `desktop/plugin.js` |
| Image on a GitHub host, 2:1 | `image:` points at `raw.githubusercontent.com/.../<sha>/plugins/achiote/banner.png` (1200×600) |

## Open questions before the first catalog PR

- **License.** Achiote is BUSL-1.1, not MIT/Apache. The catalog README sets no license
  rule, but reviewers may ask.
- **Tier / category.** The generated entry says `tier: community`, `category: tools`.
  Change these in the PR if the maintainers prefer otherwise.
- **Logo.** The catalog card shows `banner.png`. Swap the logo first (see
  `docs/BRANDING.md`) so the first listing uses the new mark.
