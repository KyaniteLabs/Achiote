#!/usr/bin/env node

try { process.loadEnvFile(); } catch { /* no .env file present */ }

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAchioteStdioServer } from './cli.js';

export { runAchioteStdioServer } from './cli.js';
export { createAchioteServer } from './server.js';
export { bundledGlobalReferenceSeeds, prioritizeReferenceSeeds } from './lib/reference-seed-planner.js';
export { getBundledReferenceResearch, getReferenceResearch } from './lib/reference-pantry.js';
export { buildInferenceBurdenSummary, findPromptOffloadCandidates, listInferenceBurdens } from './lib/inference-burden-inventory.js';
export { buildReferencePantryFixtureReport, buildReferenceSeedOperatorReport, validateReferenceSeedFixtures, writeReferenceSeedFixturesToCache } from './lib/reference-seed-operator.js';
export type { AchioteServerOptions } from './server.js';
export type { InferenceBurden, InferenceBurdenSummary, InferenceBurdenType, PromptOffloadCandidateOptions } from './lib/inference-burden-inventory.js';
export type { ReferencePantryFixtureReport, ReferenceSeedOperatorReport, ReferenceSeedOperatorTask } from './lib/reference-seed-operator.js';

const isCliEntrypoint = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isCliEntrypoint) {
  runAchioteStdioServer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
