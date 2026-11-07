# Achiote Hermes plugin — operator-path E2E

Runs the plugin the way a real Hermes install does, with nothing stubbed:

| Path | What actually executes |
|---|---|
| `1_plugin_load` | real `PluginContext` + real `PluginManager.discover_and_load()` on an isolated `HERMES_HOME`; tools/hooks/`/achiote` read back from the live registries and diffed against `plugin.yaml` |
| `2_npx_subprocess` | real `npx -y achiote@0.2.2 ask --json -- "<memory>"` child (cold npm cache), argv/exit code/parsed JSON/latency recorded |
| `3_tool_dispatch` | all five tools through `tools.registry.dispatch`; saved-dish ledger + reconstruction files inspected on disk |
| `4_cite_or_die` | cited cue passes, the same cue with sources stripped fails with reasons |
| `5_offline` | real npm failure via a dead proxy (`ECONNREFUSED`), operator-facing message + diagnostics asserted |
| `6_hooks` | real `pre_llm_call` / `pre_tool_call` chain: fragment injects the brief, unrelated turn injects nothing, uncited emit is blocked |
| `7_slash_cli` | real in-session `/achiote` handler; the real 74-choice argparse parser proves no CLI subcommand is registered |
| `8_dashboard` | real dashboard manifest discovery + `_mount_one_plugin_api` on a FastAPI app, every route via `TestClient`, bundle syntax-checked with `node --check` |
| `9_isolation` | state lives only under the scratch home; live `~/.hermes-org` plugin-data untouched |

## Run it

```bash
HERMES_SOURCE=/path/to/hermes-agent \
/home/simon/.hermes-org/installs/6bdf4c969cf45c8a/environments/676fbd68ad8d4d8486a42af67207fb93/venv/bin/python \
  tests/e2e/run_achiote_e2e.py --json /tmp/achiote-e2e-report.json
```

Use the Hermes checkout's own runtime venv (needs `fastapi`, `httpx`, `ruamel.yaml`); the bare
`hermes` shell wrapper is never invoked. The harness sets `HERMES_DISABLE_LAZY_INSTALLS=1`, clears
`HERMES_DELEGATED_CHILD_CONTEXT` / `HERMES_SESSION_PLATFORM`, creates a fresh `HERMES_HOME` under
the scratch dir and prints every resolved path before its first write.

Pytest wrapper (runs the same harness; `ACHIOTE_E2E=0` skips):

```bash
python3 -m pytest tests/e2e -q
```

Network is required for paths 2 and 8's npm fetch; path 5 deliberately has none.
