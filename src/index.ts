#!/usr/bin/env node

try { process.loadEnvFile(); } catch { /* no .env file present */ }

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAchioteCli } from './cli.js';

export { runAchioteStdioServer, runAchioteCli } from './cli.js';
export { createAchioteServer } from './server.js';
export { bundledGlobalReferenceSeeds, prioritizeReferenceSeeds } from './lib/reference-seed-planner.js';
export { getBundledReferenceResearch, getReferenceResearch } from './lib/reference-pantry.js';
export { buildInferenceBurdenSummary, findPromptOffloadCandidates, listInferenceBurdens } from './lib/inference-burden-inventory.js';
export { applyReferencePantryAppend, auditReferencePantryPopulation } from './lib/reference-pantry-population.js';
export { buildReferencePantryFixtureReport, buildReferenceSeedOperatorReport, validateReferenceSeedFixtures, writeReferenceSeedFixturesToCache } from './lib/reference-seed-operator.js';
export type { AchioteServerOptions } from './server.js';
export type { InferenceBurden, InferenceBurdenSummary, InferenceBurdenType, PromptOffloadCandidateOptions } from './lib/inference-burden-inventory.js';
export type {
  ReferencePantryArtificialTarget,
  ReferencePantryDuplicateTarget,
  ReferencePantryFamilyDepth,
  ReferencePantryPopulationAudit,
  ReferencePantryPopulationData,
  ReferencePantryPopulationIssue,
  ReferencePantryTaxonomyCountDrift,
  ReferencePantryAppendItem,
  ReferencePantryAppendPlan,
  ReferencePantryAppendResult,
} from './lib/reference-pantry-population.js';
export type { ReferencePantryFixtureReport, ReferenceSeedOperatorReport, ReferenceSeedOperatorTask } from './lib/reference-seed-operator.js';

const isCliEntrypoint = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isCliEntrypoint) {
  const cliArgs = process.argv.slice(2);
  // Terminal subcommands (`ask`, `purge`) must exit deterministically so a lingering handle (e.g. an
  // open cache/billing DB) can never keep the CLI alive past completion. The stdio server path
  // (`serve`/`mcp`/no-args) deliberately does NOT exit — it stays connected to the transport.
  const isTerminalSubcommand = cliArgs[0] === 'ask' || cliArgs[0] === 'purge';
  runAchioteCli(cliArgs)
    .then((code) => {
      if (isTerminalSubcommand) process.exit(code);
      if (code !== 0) process.exit(code);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
