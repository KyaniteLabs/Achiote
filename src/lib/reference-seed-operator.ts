import type { QualitySignalReport } from './quality-signals.js';
import { validateResearchRecord } from './research-provenance.js';
import type { ResearchRecord } from './types.js';
import {
  bundledGlobalReferenceSeeds,
  prioritizeReferenceSeeds,
  type SeedPriority,
} from './reference-seed-planner.js';

type CoverageAxisValue = {
  id?: unknown;
  label?: unknown;
};

type CoverageAxis = {
  values?: CoverageAxisValue[];
};

type CacheTarget = {
  dishFamily?: unknown;
  region?: unknown;
};

type CacheWarmingTask = {
  id?: unknown;
  seedId?: unknown;
  cacheTarget?: CacheTarget;
  coverageTags?: unknown;
  qualityTriggers?: unknown;
  doneWhen?: unknown;
};

export type ReferenceSeedOperatorIssue = {
  path: string;
  message: string;
};

export type ReferenceSeedOperatorTask = {
  id: string;
  seedId: string;
  cacheTarget: {
    dishFamily: string;
    region: string;
  };
  coverageTags: string[];
  qualityTriggers: string[];
  doneWhen: string[];
  promptForHostResearch: string;
};

export type ReferenceSeedOperatorReport = {
  priorities: SeedPriority[];
  cacheWarmingTasks: ReferenceSeedOperatorTask[];
  coverage: {
    axes: Record<string, {
      covered: number;
      total: number;
      missing: string[];
    }>;
  };
};

export type ReferenceSeedFixture = {
  seedId?: unknown;
  cacheTarget?: CacheTarget;
  record?: ResearchRecord;
};

export type ReferenceSeedFixtureCache = {
  storeResearchRecord(dishFamily: string, region: string, record: ResearchRecord): void;
  getResearchRecord(dishFamily: string, region: string): ResearchRecord | null;
};

export type ReferenceSeedFixtureWriteResult = {
  stored: number;
};

export function buildReferenceSeedOperatorReport(
  report: QualitySignalReport,
  options: { limit?: number } = {},
): ReferenceSeedOperatorReport {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
  const priorities = prioritizeReferenceSeeds(report).slice(0, limit);
  const priorityIndex = new Map(priorities.map((priority, index) => [priority.seedId, index]));
  const cacheWarmingTasks = bundledGlobalReferenceSeeds.cacheWarmingManifest.tasks
    .filter((task) => typeof task.seedId === 'string' && priorityIndex.has(task.seedId))
    .sort((a, b) => priorityIndex.get(a.seedId as string)! - priorityIndex.get(b.seedId as string)!)
    .slice(0, limit)
    .map(toOperatorTask);

  return {
    priorities,
    cacheWarmingTasks,
    coverage: summarizeCoverage(),
  };
}

export function validateReferenceSeedFixtures(input: unknown): ReferenceSeedOperatorIssue[] {
  const issues: ReferenceSeedOperatorIssue[] = [];
  if (!isRecord(input)) {
    return [{ path: 'fixture', message: 'must be an object with a fixtures array' }];
  }
  if (!Array.isArray(input.fixtures)) {
    return [{ path: 'fixtures', message: 'must be an array' }];
  }

  const validTargets = new Set(bundledGlobalReferenceSeeds.cacheWarmingManifest.tasks.map((task) => {
    const seedId = typeof task.seedId === 'string' ? task.seedId : '';
    const target = task.cacheTarget;
    const dishFamily = typeof target?.dishFamily === 'string' ? target.dishFamily : '';
    const region = typeof target?.region === 'string' ? target.region : '';
    return `${seedId}\u0000${dishFamily}\u0000${region}`;
  }));

  input.fixtures.forEach((fixture, index) => {
    const base = `fixtures[${index}]`;
    if (!isRecord(fixture)) {
      issues.push({ path: base, message: 'must be an object' });
      return;
    }
    const seedId = typeof fixture.seedId === 'string' ? fixture.seedId : '';
    const cacheTarget = isRecord(fixture.cacheTarget) ? fixture.cacheTarget : {};
    const dishFamily = typeof cacheTarget.dishFamily === 'string' ? cacheTarget.dishFamily : '';
    const region = typeof cacheTarget.region === 'string' ? cacheTarget.region : '';
    if (!validTargets.has(`${seedId}\u0000${dishFamily}\u0000${region}`)) {
      issues.push({ path: `${base}.seedId`, message: 'must reference a known seed/cache target pair' });
    }
    if (!isRecord(fixture.record)) {
      issues.push({ path: `${base}.record`, message: 'must be a typed ResearchRecord object' });
      return;
    }
    for (const issue of validateResearchRecord(fixture.record as unknown as ResearchRecord)) {
      issues.push({ path: `${base}.record.${issue.path}`, message: issue.message });
    }
  });

  return issues;
}

export function writeReferenceSeedFixturesToCache(
  input: unknown,
  cache: ReferenceSeedFixtureCache,
): ReferenceSeedFixtureWriteResult {
  const issues = validateReferenceSeedFixtures(input);
  if (issues.length > 0) {
    throw new Error(`Fixture validation failed:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`);
  }
  if (!isRecord(input) || !Array.isArray(input.fixtures)) {
    throw new Error('Fixture validation failed');
  }

  let stored = 0;
  input.fixtures.forEach((fixture, index) => {
    const entry = fixture as {
      cacheTarget: { dishFamily: string; region: string };
      record: ResearchRecord;
    };
    cache.storeResearchRecord(entry.cacheTarget.dishFamily, entry.cacheTarget.region, entry.record);
    const storedRecord = cache.getResearchRecord(entry.cacheTarget.dishFamily, entry.cacheTarget.region);
    if (JSON.stringify(storedRecord) !== JSON.stringify(entry.record)) {
      throw new Error(`Cache write verification failed for fixtures[${index}]`);
    }
    stored += 1;
  });

  return { stored };
}

function toOperatorTask(task: CacheWarmingTask): ReferenceSeedOperatorTask {
  const id = stringValue(task.id, 'unknown-task');
  const seedId = stringValue(task.seedId, 'unknown-seed');
  const cacheTarget = isRecord(task.cacheTarget) ? task.cacheTarget : {};
  const dishFamily = stringValue(cacheTarget.dishFamily, 'unknown-dish-family');
  const region = stringValue(cacheTarget.region, 'unknown-region');
  const coverageTags = stringArray(task.coverageTags);
  const qualityTriggers = stringArray(task.qualityTriggers);
  const doneWhen = stringArray(task.doneWhen);

  return {
    id,
    seedId,
    cacheTarget: { dishFamily, region },
    coverageTags,
    qualityTriggers,
    doneWhen,
    promptForHostResearch: [
      `Prepare host-led research for seed ${seedId}.`,
      `Cache target: ${dishFamily} in ${region}.`,
      `Use approved public or operator-approved sources only; Achiote does not browse or scrape.`,
      `Return a typed ResearchRecord with aliases, regions, ingredients, sensory descriptors, uncertainty, confidence, and source metadata.`,
      doneWhen.length > 0 ? `Done when: ${doneWhen.join('; ')}` : '',
    ].filter(Boolean).join(' '),
  };
}

function summarizeCoverage(): ReferenceSeedOperatorReport['coverage'] {
  const axes: ReferenceSeedOperatorReport['coverage']['axes'] = {};
  const coveredTags = new Set(bundledGlobalReferenceSeeds.referenceSeedQueue.seeds.flatMap((seed) => [
    ...stringArray(seed.forms),
    ...stringArray(seed.mechanisms),
    ...stringArray(seed.coverageTags),
  ]));

  for (const [axisId, axis] of Object.entries(bundledGlobalReferenceSeeds.globalCoverageMatrix.axes as Record<string, CoverageAxis>)) {
    const values = Array.isArray(axis.values) ? axis.values : [];
    const ids = values.map((value) => stringValue(value.id, '')).filter(Boolean);
    const covered = ids.filter((id) => coveredTags.has(`${axisId}.${id}`));
    axes[axisId] = {
      covered: covered.length,
      total: ids.length,
      missing: ids.filter((id) => !covered.includes(id)),
    };
  }

  return { axes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}
