# Catalog PR draft — for Simon

Do not open this pull request from automation. Do not publish, and do not run `hermes update` or restart a gateway. Simon submits it, after the checklist below.

Target repository: `NousResearch/hermes-agent`
Target file: `plugin-catalog/achiote.yaml` (one new file)
Suggested PR title: `catalog: add achiote (community)`

The `sha` below is a placeholder. Replace it with the full 40-character commit that is actually merged and that `hermes plugins validate --install-deps` has passed against. A short SHA, a branch, or this placeholder will be rejected by catalog CI.

Banner and screenshots are still missing. Catalog image URLs have to be on a GitHub host and pinned to that same commit. Do not submit until `docs/banner.png` (2:1) and the pane screenshots exist at the pinned commit.

License: the plugin declares `BUSL-1.1` (Additional Use Grant: none). Say that in the PR so the reviewer sees it. Heritage locale is not in this plugin (it stays in DialectOS). Photo→memory and `/achiote cook` are not part of this listing.

## PR body

Achiote turns a half-remembered family dish into a cited minimum-viable nostalgia cue, using ingredients that can be bought locally. This entry adds the native Hermes plugin: `plugin.yaml`, `pre_llm_call` and `pre_tool_call`, `/achiote`, reconstruct tools, a Desktop Nostalgia pane, and a provenance graph.

Surfaces: tools (`achiote_reconstruct`, `achiote_get_reconstruction`, `achiote_save_dish`, `achiote_list_dishes`, `achiote_cite_check`), hooks (`pre_llm_call`, `pre_tool_call`), the `/achiote` slash command, a bundled skill, `desktop/plugin.js`, and `dashboard/plugin_api.py`.

### Disclosure

- Shells out to `npx -y achiote@0.2.2` (npm download on first run; needs Node ≥ 22).
- The child gets a minimal allowlisted environment. It does not receive the parent process environment. Credentials are taken only from a Hermes secret scope that cannot fall through to the ambient environment. Routing config (`OPENAI_BASE_URL`, `OPENAI_MODEL`, `ACHIOTE_ASK_PROVIDER`) may fall back to the ambient environment so a scoped key is not sent to the provider default.
- The child runs from a plugin-owned working directory so the CLI cannot load an inherited `.env`.
- Optional network after install: the model provider and Serper, only when those keys are configured. No telemetry.
- State (reconstructions, session pointers, saved dishes) is stored under `<HERMES_HOME>/plugin-data/achiote/`.
- Cite-or-die checks that a concrete source value and a concrete local-substitution value are present. It does not check that the source is true.
- License is BUSL-1.1, Additional Use Grant: none.

### Not in this plugin

- Heritage-locale / DialectOS.
- Photo→memory.
- `/achiote cook` (disabled unless `enable_cook_slash` is turned on later).

## `plugin-catalog/achiote.yaml`

```yaml
name: achiote
repo: https://github.com/KyaniteLabs/Achiote
sha: REPLACE_WITH_MERGED_40_CHAR_SHA
subdir: plugins/achiote-hermes
description: Turn a half-remembered family dish into a cited nostalgia cue with local substitutes.
maintainer: KyaniteLabs
tier: community
category: memory
requires_hermes: ">=0.21.6"
version: "0.1.0"
title: Achiote
readme: true
# Add after the banner and screenshots exist at the pinned sha:
# image: https://raw.githubusercontent.com/KyaniteLabs/Achiote/REPLACE_WITH_MERGED_40_CHAR_SHA/plugins/achiote-hermes/docs/banner.png
# screenshots:
#   - https://raw.githubusercontent.com/KyaniteLabs/Achiote/REPLACE_WITH_MERGED_40_CHAR_SHA/plugins/achiote-hermes/docs/nostalgia-cue.png
#   - https://raw.githubusercontent.com/KyaniteLabs/Achiote/REPLACE_WITH_MERGED_40_CHAR_SHA/plugins/achiote-hermes/docs/provenance.png
known_issues:
  - First reconstruct downloads achiote from npm and needs Node >= 22.
  - Cite-or-die checks that evidence values are present, not that they are true.
  - License is BUSL-1.1 with no additional use grant.
capabilities:
  provides_tools:
    - achiote_reconstruct
    - achiote_get_reconstruction
    - achiote_save_dish
    - achiote_list_dishes
    - achiote_cite_check
  provides_hooks:
    - pre_llm_call
    - pre_tool_call
  provides_middleware: []
  requires_env: []
```

## Before Simon clicks submit

- [ ] Plugin PR is merged. `sha` is that commit, 40 hex characters.
- [ ] `hermes plugins validate plugins/achiote-hermes --install-deps` passed on that commit.
- [ ] `docs/banner.png` is 2:1 and the pane screenshots are in `docs/` at that commit.
- [ ] `image` and `screenshots` URLs are uncommented and pinned to the same sha.
- [ ] This file was copied by hand. Nothing here was posted to the catalog.
