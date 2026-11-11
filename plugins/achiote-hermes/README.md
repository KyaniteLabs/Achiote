# Achiote for Hermes (native plugin)

Turn a half-remembered family dish into a researched, **cited** minimum-viable nostalgia cue and a recipe that uses ingredients you can buy where you live — inside Hermes.

| Surface | What it does |
|---|---|
| `pre_llm_call` | Detects food-memory fragments and injects a research brief + **cite-or-die** rules |
| `pre_tool_call` | Blocks (with a host-visible `message`) outbound/emit tools that carry an uncited nostalgia cue. Research/read tools are never gated |
| `/achiote ask\|list\|save\|status\|help` | Gateway-safe slash (no `purge` / `serve` / arbitrary CLI). `save`/`status` take an explicit `--id` / ID (slash has no session). `/achiote cook` is a Monday stretch stub |
| `achiote_reconstruct` | One-shot reconstruct via `achiote ask --json`; `user_location` is sent to the engine; returns a bounded summary + `reconstruction_id` |
| `achiote_get_reconstruction` | Full-result handle: page `answer` / `receipt` / `sources` by `reconstruction_id` |
| `achiote_cite_check` | Cite-or-die gate: needs a concrete source value (DOI/URL/ISBN or engine-researched fact) **and** a concrete local-substitution value. Field names / labels never count |
| `achiote_save_dish` / `achiote_list_dishes` | Family dishes under `<HERMES_HOME>/plugin-data/achiote/`; save attaches the given `reconstruction_id` or **this session's** last reconstruction only |
| Desktop **Nostalgia** pane | Cue + citations + local swaps + provenance graph + saved dishes |
| Skill `achiote:achiote` | Bundled workflow skill |

**Not in this plugin:** heritage-locale / Spanish-only packs (that lives in DialectOS). Photo→memory is Monday go/no-go only.

## Install

```bash
hermes plugins install KyaniteLabs/Achiote/plugins/achiote-hermes
hermes plugins enable achiote
# Desktop: Capabilities → Plugins → enable Achiote → Rescan if needed
```

Requires **Node ≥ 22** and `npx` on PATH for reconstruct. Optional model key (e.g. `ANTHROPIC_API_KEY`) for full `achiote ask`; granular deterministic tools inside Achiote still work without it when used via the MCP server path.

Settings under `plugins.entries.achiote.settings`:

| Key | Default | Notes |
|---|---|---|
| `achiote_command` | `npx -y achiote@0.2.2` | Set to `achiote` if installed globally |
| `inject_on_fragment` | `true` | Fragment → research brief |
| `cite_or_die` | `true` | Guardrails + soft block |
| `timeout_seconds` | `180` | Child process timeout |
| `enable_cook_slash` | `false` | Monday stretch |

## Disclosure

- Shells out to `npx -y achiote@0.2.2` (downloads from npm on first run).
- Child environment is **scrubbed** (no full `os.environ`, no inherited `NODE_OPTIONS`); optional API keys are read through Hermes secret scope when available.
- The child runs from a plugin-owned working directory (`plugin-data/achiote/run/`), so the CLI's `process.loadEnvFile()` cannot pull a workspace/profile `.env` back in; the plugin refuses to run if a `.env` appears there.
- Writes research cache, per-reconstruction envelopes (last 50 unsaved; a saved dish keeps its full answer + receipt), session pointers, and saved dishes under `<HERMES_HOME>/plugin-data/achiote/` (profile-separate; writes are locked + atomic).
- Does **not** persist raw food memories into the Achiote culture cache by product design (see upstream `docs/PRIVACY-RETENTION.md`).
- Network: npm download on first run; optional Serper/model provider calls when keys are configured inside Achiote.
- License of upstream Achiote is **BUSL-1.1**; this plugin wrap inherits that product license.

## Known issues

- First run downloads `achiote` from npm; an npm min-release-age policy can block a freshly published pin until it ages (≥3 days before catalog merge).
- Cite-or-die checks evidence values, not truth: an engine-researched fact counts as a source; DOIs come from the receipt share card. Always run `achiote_cite_check` before treating a cue as final.
- `user_location` reaches the engine as message text (`I live in <place>`), since `achiote ask` has no location flag.
- Desktop pane needs the Python plugin enabled in `plugins.enabled` so `dashboard/plugin_api.py` mounts; otherwise the pane shows backend-offline.
- `/achiote cook` and photo→memory are stubs until Monday go/no-go.
- Box Node must be ≥22 to exercise reconstruct locally (engines field on `achiote`).

## Screenshots / banner

Place a **2:1** banner at `docs/banner.png` and pane screenshots under `docs/` before the catalog PR (paths referenced from the future `plugin-catalog/achiote.yaml`).

## Demo (<90s)

Offline path (no Hermes gateway, no model, no network):

```bash
python3 plugins/achiote-hermes/demo_90s.py
```

It runs fragment → cite-or-die fail → cited cue → provenance graph (source → claim) → save in one session → reopen the full answer in a later session, and exits non-zero if that takes 90 seconds or more.

Live path, once the plugin is enabled on a Hermes profile:

1. `/achiote ask "pass-teh-lay my Puerto Rican grandma steamed in banana leaves, maybe pork"`
2. Open Desktop **Nostalgia** pane → provenance graph + cue.
3. Show cite-or-die fail (strip sources) then pass after `achiote_cite_check`.

Catalog PR text for Simon is `docs/CATALOG-PR.md`. It is a draft. Do not submit it.

## Tests

```bash
python3 -m pytest plugins/achiote-hermes/tests -q
node --test plugins/achiote-hermes/tests/desktop_view.test.mjs plugins/achiote-hermes/tests/desktop_scope.test.mjs
```

The MCP server + skill for Claude/Cursor stay at the repo root; this directory is the Hermes-native wrap.
