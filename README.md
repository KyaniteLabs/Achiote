# Member Berries

Member Berries is a local **Model Context Protocol (MCP)** server for culinary nostalgia workflows. It helps a host model reverse-engineer the sensory triggers of remembered dishes using bundled cultural dish-family data, ingredient compound data, and regional sourcing hints.

> "The nostalgia lives in the maillard crust's interaction with the lactic tang — here's how to reproduce that."

## What It Does Today

Member Berries provides six MCP tools:

| Tool | Implemented behavior |
|------|----------------------|
| `resolve_dish_name` | Resolves a dish name to a broad canonical dish family using bundled aliases, fuzzy matching, and transliterations. |
| `analyze_nostalgic_dish` | Returns sensory-dimension criteria and a bounded prompt for the host model to analyze a food memory. |
| `find_sensory_substitutes` | Returns compound/group-matched substitutes from bundled ingredient data, plus regional hints when available. |
| `source_ingredients` | Returns static regional store/corridor hints and a host-model prompt for sourcing. It does not perform live inventory or price lookup. |
| `discover_regional_similars` | Returns bundled dish-family context and a host-model prompt for neighboring/regional comparisons. |
| `generate_recipe` | Returns an expected recipe schema and a host-model prompt. It does not deterministically generate final recipe steps by itself. |

All tools return MCP `structuredContent` plus backwards-compatible JSON text.

## What It Does Not Do Yet

The current implementation is intentionally local and offline. It does **not** perform live web search, geocoding, grocery inventory lookup, price lookup, or external recipe scraping. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the provider-backed research plan.

## Requirements

- Node.js `>=22.0.0`
- npm

`better-sqlite3` is a native dependency, so unsupported Node/platform combinations may need a compiler toolchain or a supported prebuild.

## Installation

```bash
npm ci
npm run build
```

## Using with Claude Code or another MCP client

After building, add the stdio server to your MCP settings:

```json
{
  "mcpServers": {
    "member-berries": {
      "command": "node",
      "args": ["/path/to/member-berries/dist/index.js"]
    }
  }
}
```

If installed as a package, the CLI binary is `member-berries`.

## Cache and privacy

Member Berries is a local stdio MCP server. It does not open an HTTP port. The SQLite research cache path is:

1. `$MEMBER_BERRIES_CACHE_PATH`, if set
2. `$XDG_CACHE_HOME/member-berries/culture-cache.db`, if `XDG_CACHE_HOME` is set
3. `~/.cache/member-berries/culture-cache.db`

User memories can be emotionally sensitive. Do not add network-backed providers without documenting what is sent, where it is sent, and how it is cached.

## Development

```bash
npm ci                         # Install locked dependencies
npm run typecheck              # TypeScript no-emit check
npm run build                  # Compile TypeScript
npm test                       # Run tests
npm run check                  # Typecheck + build + tests
npm audit --audit-level=moderate
npm pack --dry-run             # Inspect publish contents
npm start                      # Start the MCP server after build
```

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## The Science

Food-evoked nostalgia is well documented in psychology and neuroscience, especially through smell/taste memory pathways. This repository should treat science and cultural claims as data that require provenance. The roadmap includes adding citations and source metadata to bundled datasets.

## License

MIT
