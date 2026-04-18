#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMemberBerriesStdioServer } from './cli.js';

export { runMemberBerriesStdioServer } from './cli.js';
export { createMemberBerriesServer } from './server.js';
export type { MemberBerriesServerOptions } from './server.js';

const isCliEntrypoint = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isCliEntrypoint) {
  runMemberBerriesStdioServer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
