# Changelog

## 0.2.3 — 2026-11-19

- Correct the Achiote skill's tool names so they match the registered MCP tools.
- Strengthen the static regression check to catch every backticked snake_case tool-like identifier in the skill.
- Correct the README's tool count and document `reconstruct_food_memory`.
- Publish complete OpenAPI JSON and YAML specifications for all 14 HTTP routes, including `/mcp`.
- Make the dependency audit release gate fail closed; the picomatch advisory was withdrawn upstream, and no dependency downgrade or version change was needed.

This release note covers the npm package and its bundled documentation/checks. Site-side consent, regional privacy, and API-key authentication deployment fixes are not part of this package release.
