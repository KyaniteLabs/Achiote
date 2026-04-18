#!/usr/bin/env node

import { runMemberBerriesStdioServer } from '../dist/index.js';

runMemberBerriesStdioServer().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
