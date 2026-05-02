#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { QA_ARTIFACT_MANIFEST_FILE, writeQaRunManifest } from './lib/qa-artifact-pipeline.mjs';
import {
  mineTelemetryPatterns,
  normalizeLocalCanarySummary,
  normalizeLocalProfilerArtifact,
  normalizeWeakCloudRow,
  renderTelemetryMarkdown,
} from '../dist/lib/model-telemetry.js';

const args = parseArgs(process.argv.slice(2));
const outputDir = stringArg('out') ?? path.join('artifacts', 'model-telemetry-report');
const inputs = positionalArgs();
const files = inputs.length > 0 ? expandInputs(inputs) : expandInputs(defaultInputs());
const events = [];
const skipped = [];

for (const file of files) {
  try {
    events.push(...readTelemetryFile(file));
  } catch (error) {
    skipped.push({
      file,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const generatedAt = new Date().toISOString();
const patterns = mineTelemetryPatterns(events, {
  latencyOutlierMs: numberArg('latency-outlier-ms') ?? 120_000,
});
const report = { generatedAt, inputFiles: files, skipped, events, patterns };
const markdown = renderTelemetryMarkdown({ events, patterns, generatedAt });

fs.mkdirSync(outputDir, { recursive: true });
const jsonPath = path.join(outputDir, 'summary.json');
const markdownPath = path.join(outputDir, 'summary.md');
const manifestPath = path.join(outputDir, QA_ARTIFACT_MANIFEST_FILE);
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, markdown);
writeQaRunManifest(manifestPath, {
  artifactDir: outputDir,
  runKind: 'model-telemetry-report',
  stopCondition: 'Telemetry inputs normalized and report artifacts written.',
  sampleCount: events.length,
  providers: unique(events.map((event) => event.provider)),
  models: unique(events.map((event) => event.model)),
  excludedEvidenceReasons: skipped.map((entry) => `${entry.file}: ${entry.error}`),
  outputs: { jsonPath, markdownPath },
});

process.stdout.write(`${JSON.stringify({
  generatedAt,
  inputFiles: files.length,
  skipped: skipped.length,
  events: events.length,
  patterns: patterns.map((pattern) => ({ id: pattern.id, count: pattern.count })),
  jsonPath,
  markdownPath,
  manifestPath,
}, null, 2)}\n`);

function readTelemetryFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.jsonl')) {
    return text.split(/\r?\n/)
      .map((line, index) => ({ line, index: index + 1 }))
      .filter(({ line }) => line.trim().length > 0)
      .flatMap(({ line, index }) => {
        const parsed = JSON.parse(line);
        return looksLikeWeakCloudRow(parsed)
          ? [normalizeWeakCloudRow(parsed, `${file}:${index}`)]
          : [];
      });
  }

  if (!file.endsWith('.json')) return [];
  const parsed = JSON.parse(text);
  if (looksLikeLocalCanarySummary(parsed)) {
    return normalizeLocalCanarySummary(parsed, file);
  }
  if (looksLikeLocalProfilerArtifact(parsed)) {
    return normalizeLocalProfilerArtifact(parsed, file);
  }
  if (looksLikeWeakCloudRow(parsed)) {
    return [normalizeWeakCloudRow(parsed, file)];
  }
  if (Array.isArray(parsed)) {
    return parsed.flatMap((row, index) => looksLikeWeakCloudRow(row)
      ? [normalizeWeakCloudRow(row, `${file}:${index + 1}`)]
      : []);
  }
  if (Array.isArray(parsed.events)) {
    return parsed.events.filter(looksLikeNormalizedEvent);
  }
  return [];
}

function looksLikeLocalCanarySummary(value) {
  return value && typeof value === 'object' && Array.isArray(value.results);
}

function looksLikeWeakCloudRow(value) {
  return value
    && typeof value === 'object'
    && (typeof value.provider === 'string' || typeof value.model === 'string')
    && (typeof value.prompt === 'string' || typeof value.id === 'string' || typeof value.mode === 'string');
}

function looksLikeLocalProfilerArtifact(value) {
  return value
    && typeof value === 'object'
    && typeof value.profile === 'string'
    && value.intendedLoadPayload
    && Array.isArray(value.events);
}

function looksLikeNormalizedEvent(value) {
  return value
    && typeof value === 'object'
    && typeof value.source === 'string'
    && typeof value.model === 'string'
    && typeof value.provider === 'string';
}

function expandInputs(paths) {
  const expanded = [];
  for (const input of paths) {
    if (!fs.existsSync(input)) continue;
    const stat = fs.statSync(input);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(input).sort()) {
        expanded.push(...expandInputs([path.join(input, child)]));
      }
      continue;
    }
    if (/\.(?:json|jsonl)$/i.test(input)) expanded.push(input);
  }
  return expanded;
}

function defaultInputs() {
  return [
    path.join('artifacts', 'local-canary-post-fixes'),
    path.join('artifacts', 'weak-cloud-overnight'),
    path.join('artifacts', 'weak-cloud'),
    path.join('artifacts', 'local-inference-profiler'),
  ];
}

function parseArgs(argv) {
  const parsed = { flags: new Map(), positionals: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      parsed.positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.flags.set(key, next);
      index += 1;
    } else {
      parsed.flags.set(key, true);
    }
  }
  return parsed;
}

function stringArg(name) {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function numberArg(name) {
  const value = stringArg(name);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function positionalArgs() {
  return args.positionals;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? '')).filter(Boolean))].sort();
}
