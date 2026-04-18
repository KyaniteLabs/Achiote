# Member Berries

Culinary reverse engineering that recreates the **sensory triggers** of nostalgic dishes using locally available ingredients.

> "The nostalgia lives in the maillard crust's interaction with the lactic tang — here's how to reproduce that."

## What It Does

You describe a dish you or your family miss from another place or time. Member Berries:

1. Identifies the specific sensory elements that carry the nostalgic trigger
2. Reverse-engineers the chemistry of those elements (volatile compounds, textures, flavor balance)
3. Finds locally available ingredients that reproduce the same sensory experience
4. Generates a complete recipe you can cook right now, where you are

## How It Works

Member Berries is an MCP (Model Context Protocol) server that provides 6 tools:

| Tool | What It Does |
|------|-------------|
| `resolve_dish_name` | Maps any spelling, transliteration, or regional name to the canonical dish |
| `analyze_nostalgic_dish` | Decomposes a memory into 5 sensory dimensions and identifies nostalgia-critical elements |
| `find_sensory_substitutes` | Finds chemistry-aware ingredient substitutions by matching volatile compounds |
| `source_ingredients` | Finds where to buy each ingredient near you |
| `discover_regional_similars` | Finds related dishes from neighboring cultures |
| `generate_recipe` | Generates the complete adapted recipe with confidence levels |

## Installation

```bash
npm install
npm run build
```

### Using with Claude Code

Add to your Claude Code MCP settings:

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

### Using with the Skill

Copy `skill/SKILL.md` to your Claude Code skills directory for the full guided pipeline experience.

## The Science

Food-evoked nostalgia is well-documented in psychology and neuroscience:

- Smell and taste process directly through the hippocampus and amygdala (memory and emotion centers)
- Food-evoked nostalgia has a more positive emotional profile than music or photo-triggered nostalgia
- Reminiscence therapy using food smells outperforms discussion-based therapy for loneliness in older adults

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Run tests
npm run test:watch   # Run tests in watch mode
npm start            # Start the MCP server
```

## License

MIT
