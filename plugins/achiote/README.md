# Achiote plugin

![Achiote icon](icon.png)

Recreate a dish someone remembers using ingredients available where they are.
The plugin adds the Achiote MCP server and the `achiote` skill to your agent.

It is a portable Agent Plugins v1 package (`plugin.json`, `mcp.json`, `skills/`).
Hermes loads it as-is. Other hosts that read Agent Plugins v1 can load it too.

## Install (Hermes)

```bash
hermes plugins install KyaniteLabs/Achiote --subdir plugins/achiote
hermes plugins enable achiote
```

Once the plugin is in the Hermes plugin catalog, `hermes plugins install achiote` works too.

## Requirements

- Node.js 22 or newer, with `npx` on `PATH`.

## What it runs

`mcp.json` starts `npx -y achiote@<version>`. The version is pinned exactly and
always matches this repository's `package.json` at the same commit, so the plugin
never floats to a newer npm release. The first launch downloads the `achiote`
package and its dependencies from npm. Later launches use the npm cache.

The plugin contains no Python, no hooks, no desktop code and no self-updater.
Updates arrive only when the pinned version changes in a reviewed commit.

## Network, keys and data

- **Without any key**, the granular deterministic tools work fully offline after
  the first download.
- **`reconstruct_food_memory`** (the single-call path) calls a model provider. Give the
  server `ANTHROPIC_API_KEY`, or point it at a local OpenAI-compatible server. The memory
  text you send goes to the provider you configure.

  Hermes starts the server with a filtered environment and does not forward your shell's
  or `~/.hermes/.env`'s API keys to it, so exporting the key is not enough. Add the key
  to a `mcp_servers` entry in `config.yaml`. An entry with the same name replaces the
  package's own, so repeat the launcher:

  ```yaml
  mcp_servers:
    achiote:
      command: npx
      args: ["-y", "achiote@0.2.2"]   # keep in step with plugin.json
      env:
        ANTHROPIC_API_KEY: "<your key>"
  ```

  Without a key, the granular tools still work offline.
- **`search_web`** calls `google.serper.dev` only when `SERPER_API_KEY` is set.
  Set `ACHIOTE_DISABLE_SEARCH_WEB=true` to turn it off.
- **Local cache:** dish and region research (never raw memories) is cached in SQLite at
  `$ACHIOTE_CACHE_PATH`, else `$PLUGIN_DATA/culture-cache.db` (the per-plugin data
  folder Hermes provides), else `$XDG_CACHE_HOME/achiote/culture-cache.db`, else
  `~/.cache/achiote/culture-cache.db`. If the chosen folder is not writable it falls
  back to `~/.cache/achiote/` and logs a warning to stderr. `achiote purge` deletes the
  cache its own environment points at, so run it with the same `PLUGIN_DATA` or
  `ACHIOTE_CACHE_PATH` the server had.
- Achiote sends no telemetry from the MCP server.

## Files in this folder

Several files here are copies that `scripts/hermes-plugin.mjs` writes. Do not edit
them by hand; edit the source and run `node scripts/hermes-plugin.mjs sync`.

| File | Source |
|---|---|
| `plugin.json`, `mcp.json` | generated from `package.json` (version) |
| `skills/achiote/SKILL.md` | `skill/SKILL.md` |
| `icon.png` | `branding/achiote-512.png` |
| `banner.png` | `branding/achiote-banner.png` |
| `LICENSE` | `LICENSE` |

`npm run lint` fails if any copy drifts. See `docs/HERMES_PLUGIN.md` for the release
and catalog steps.

## License

Business Source License 1.1. See [LICENSE](LICENSE).

## Install

Claude Code (2.1.275 or later):

```
/plugin install achiote --marketplace KyaniteLabs/achiote
```

Codex:

```
codex plugin marketplace add KyaniteLabs/achiote
```
