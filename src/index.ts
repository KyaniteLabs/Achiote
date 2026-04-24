#!/usr/bin/env node

try { process.loadEnvFile(); } catch { /* no .env file present */ }

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAchioteStdioServer } from './cli.js';

export { runAchioteStdioServer } from './cli.js';
export { createAchioteServer } from './server.js';
export type { AchioteServerOptions } from './server.js';

const isCliEntrypoint = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isCliEntrypoint) {
  runAchioteStdioServer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
