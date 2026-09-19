#!/usr/bin/env node

import { runAchioteCli } from '../dist/index.js';

const cliArgs = process.argv.slice(2);
// Terminal subcommands (`ask`, `purge`) exit deterministically so a lingering handle (e.g. an open
// cache/billing DB) can never keep the CLI alive past completion. `serve`/`mcp`/no-args resolve with 0
// but keep the process alive via the stdio transport, so exiting on 0 would kill the MCP server.
const isTerminalSubcommand = cliArgs[0] === 'ask' || cliArgs[0] === 'purge';
runAchioteCli(cliArgs)
  .then((code) => {
    if (isTerminalSubcommand) process.exit(code);
    if (code) process.exit(code);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
