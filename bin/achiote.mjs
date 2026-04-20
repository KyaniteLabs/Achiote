#!/usr/bin/env node

import { runAchioteStdioServer } from '../dist/index.js';

runAchioteStdioServer().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
